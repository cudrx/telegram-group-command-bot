import { serializeError } from '../../logging/logger.js';
import { normalizeSpeechText } from '../../tts/speech-cleanup.js';
import { runWithReplyVoiceRecording } from './helpers.js';
import { dispatchTextReply } from './outbound-voice.js';
import type { ChatOrchestratorDeps, ReplyRequest } from './types.js';

export const OUTBOUND_TTS_READ_MAX_CHARS = 500;
export const READ_TTS_COOLDOWN_MS = 60 * 60 * 1000;
export const READ_TTS_HOURLY_VOICE_LIMIT = 3;
export const READ_TTS_USAGE_FALLBACK =
  'Сделай reply на текстовое сообщение и отправь /read.';
export const READ_TTS_TOO_LONG_FALLBACK =
  'Сообщение слишком длинное, я могу прочитать только до 500 символов.';
export const READ_TTS_FAILED_FALLBACK =
  'Не удалось озвучить сообщение. Попробуй позже.';

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
      fallbackText: READ_TTS_USAGE_FALLBACK,
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
      fallbackText: `Я уже прочитал 3 сообщения за час в этом чате. Попробуй через ${Math.ceil(
        remainingMs / 60_000
      )} мин.`,
      reason: 'cooldown'
    };
  }

  const cleanup = normalizeSpeechText(target.text, OUTBOUND_TTS_READ_MAX_CHARS);

  if (!cleanup.ok) {
    return {
      ok: false,
      fallbackText:
        cleanup.reason === 'length'
          ? READ_TTS_TOO_LONG_FALLBACK
          : READ_TTS_USAGE_FALLBACK,
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
      text: READ_TTS_FAILED_FALLBACK
    });

    return { outputMode: 'text' };
  }

  const textToSpeechProvider = input.deps.textToSpeechProvider;

  try {
    const synthesized = await runWithReplyVoiceRecording(
      input.deps,
      input.request.chatId,
      () =>
        textToSpeechProvider.synthesize({
          text: decision.speechText,
          timeoutMs: input.deps.env.llmTimeoutMs
        })
    );
    const sent = await input.deps.voiceDispatcher({
      chatId: input.request.chatId,
      replyToMessageId: input.request.triggerMessageId,
      audioBytes: synthesized.audioBytes,
      filename: `read-${input.request.triggerMessageId}.ogg`,
      mimeType: synthesized.mimeType
    });

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
      text: READ_TTS_FAILED_FALLBACK
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
