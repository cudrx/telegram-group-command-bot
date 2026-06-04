import { readActionConfig } from '../../../config/runtime/index.js';
import { text } from '../../../locales/locale.js';
import { serializeError } from '../../../logging/logger.js';
import { normalizeSpeechText } from '../../../tts/speech-cleanup.js';
import { dispatchTextReply } from '../../chat-orchestrator/outbound-voice.js';
import type {
  ChatOrchestratorDeps,
  ReplyRequest
} from '../../chat-orchestrator/types.js';
import { runWithProcessStatus } from '../../process-status.js';

export const OUTBOUND_TTS_READ_MAX_CHARS =
  readActionConfig.outboundTts.maxChars;
export const READ_TTS_COOLDOWN_MS = readActionConfig.outboundTts.cooldownMs;
export const READ_TTS_HOURLY_VOICE_LIMIT =
  readActionConfig.outboundTts.hourlyVoiceLimit;

export type ReadTtsDecision =
  | { ok: true; speechText: string }
  | { ok: false; fallbackText: string; reason: string };

export function decideReadTts(input: {
  request: ReplyRequest;
  chatState: {
    readLastVoiceAt: string | null;
    readTtsVoiceCount: number;
  };
  now: string;
}): ReadTtsDecision {
  const target = input.request.replyToMessageSnapshot;

  if (!target || target.text.trim().length === 0) {
    return {
      ok: false,
      fallbackText: text.read.usageFallback,
      reason: 'missing_text_reply'
    };
  }

  const remainingMs = getReadCooldownRemainingMs(
    input.chatState.readLastVoiceAt,
    input.now
  );

  if (
    remainingMs > 0 &&
    input.chatState.readTtsVoiceCount >= READ_TTS_HOURLY_VOICE_LIMIT
  ) {
    return {
      ok: false,
      fallbackText: formatReadTtsCooldownFallback(remainingMs),
      reason: 'cooldown'
    };
  }

  const cleanup = normalizeSpeechText(target.text, OUTBOUND_TTS_READ_MAX_CHARS);

  if (!cleanup.ok) {
    return {
      ok: false,
      fallbackText:
        cleanup.reason === 'length'
          ? text.read.tooLongFallback(OUTBOUND_TTS_READ_MAX_CHARS)
          : text.read.usageFallback,
      reason: cleanup.reason
    };
  }

  return { ok: true, speechText: cleanup.text };
}

export async function runReadTtsJob(input: {
  deps: ChatOrchestratorDeps;
  request: ReplyRequest;
  logger: ChatOrchestratorDeps['logger'];
}): Promise<{ outputMode: 'text' | 'voice' }> {
  const now = input.deps.now();
  const chatState = input.deps.db.getChatState(input.request.chatId);
  const decision = decideReadTts({
    request: input.request,
    chatState: {
      readLastVoiceAt: chatState?.readLastVoiceAt ?? null,
      readTtsVoiceCount: chatState?.readTtsVoiceCount ?? 0
    },
    now
  });

  input.logger.debug('read_tts_decision_evaluated', {
    reason: decision.ok ? 'ready' : decision.reason,
    ok: decision.ok
  });

  if (!decision.ok) {
    await dispatchTextReply({
      deps: input.deps,
      request: input.request,
      text: decision.fallbackText
    });

    return { outputMode: 'text' };
  }

  if (!input.deps.textToSpeechProvider) {
    await dispatchTextReply({
      deps: input.deps,
      request: input.request,
      text: text.read.failedFallback
    });

    return { outputMode: 'text' };
  }

  const textToSpeechProvider = input.deps.textToSpeechProvider;

  try {
    const { sent, synthesized } = await runWithProcessStatus(
      input.deps,
      {
        chatId: input.request.chatId,
        replyToMessageId: input.request.triggerMessageId,
        status: {
          preset: 'voice_generation'
        }
      },
      async (status) => {
        await status.stage('synthesize');
        const synthesized = await textToSpeechProvider.synthesize({
          text: decision.speechText,
          timeoutMs: input.deps.env.llmTimeoutMs
        });
        await status.stage('upload');
        const sent = await input.deps.voiceDispatcher({
          chatId: input.request.chatId,
          replyToMessageId: input.request.triggerMessageId,
          audioBytes: synthesized.audioBytes,
          filename: `read-${input.request.triggerMessageId}.ogg`,
          mimeType: synthesized.mimeType
        });

        return { sent, synthesized };
      }
    );

    input.deps.db.saveBotMessage({
      chatId: input.request.chatId,
      chatType: input.request.chatType,
      chatTitle: input.request.chatTitle,
      messageId: sent.messageId,
      text: decision.speechText,
      createdAt: sent.createdAt,
      userId: input.deps.bot.userId,
      username: input.deps.bot.username,
      displayName: input.deps.bot.displayName,
      replyToMessageId: input.request.triggerMessageId,
      outputMode: 'voice'
    });
    input.deps.db.updateChatTtsState({
      chatId: input.request.chatId,
      ...getNextReadTtsUsageState(
        {
          readLastVoiceAt: chatState?.readLastVoiceAt ?? null,
          readTtsVoiceCount: chatState?.readTtsVoiceCount ?? 0
        },
        now
      )
    });

    input.logger.debug('tts_voice_sent', {
      intent: input.request.intent,
      provider: synthesized.provider,
      providerModel: synthesized.providerModel,
      audioBytes: synthesized.audioBytes.byteLength
    });

    return { outputMode: 'voice' };
  } catch (error) {
    input.logger.warn('tts_synthesis_failed', {
      intent: input.request.intent,
      ...serializeError(error)
    });
    await dispatchTextReply({
      deps: input.deps,
      request: input.request,
      text: text.read.failedFallback
    });

    return { outputMode: 'text' };
  }
}

function getNextReadTtsUsageState(
  state: {
    readLastVoiceAt: string | null;
    readTtsVoiceCount: number;
  },
  now: string
): {
  readLastVoiceAt: string | null;
  readTtsVoiceCount: number;
} {
  const remainingMs = getReadCooldownRemainingMs(state.readLastVoiceAt, now);
  const previousCount =
    state.readLastVoiceAt && remainingMs === 0 ? 0 : state.readTtsVoiceCount;
  const nextCount = previousCount + 1;

  return {
    readLastVoiceAt: nextCount >= READ_TTS_HOURLY_VOICE_LIMIT ? now : null,
    readTtsVoiceCount: nextCount
  };
}

function getReadCooldownRemainingMs(
  lastVoiceAt: string | null,
  now: string
): number {
  if (!lastVoiceAt) {
    return 0;
  }

  const elapsed = new Date(now).getTime() - new Date(lastVoiceAt).getTime();

  return Math.max(READ_TTS_COOLDOWN_MS - elapsed, 0);
}

function formatReadTtsCooldownFallback(remainingMs: number): string {
  return text.read.cooldownFallback(
    READ_TTS_HOURLY_VOICE_LIMIT,
    Math.ceil(remainingMs / 60_000)
  );
}
