import type { BotOutputMode } from '../../domain/models.js';
import type { LlmReplyResult } from '../../llm/openai-compatible-client/index.js';
import type { AppLogger } from '../../logging/logger.js';
import { serializeError } from '../../logging/logger.js';
import { decideAnswerTts } from '../../tts/outbound-policy.js';
import { runWithReplyVoiceRecording } from './helpers/reply.js';
import type {
  ChatOrchestratorDeps,
  ReplyRequest,
  SentBotMessage
} from './types.js';

export async function dispatchGeneratedReply(input: {
  deps: ChatOrchestratorDeps;
  request: ReplyRequest;
  logger: AppLogger;
  generatedText: string;
  formattedText: string;
  llmResult: LlmReplyResult;
}): Promise<{ outputMode: BotOutputMode; sent: SentBotMessage }> {
  const chatState = input.deps.db.getChatState(input.request.chatId);

  if (!chatState || !input.deps.textToSpeechProvider) {
    const sent = await dispatchTextReply({
      deps: input.deps,
      request: input.request,
      text: input.formattedText
    });

    return { outputMode: 'text', sent };
  }

  const textToSpeechProvider = input.deps.textToSpeechProvider;
  const decision = decideAnswerTts({
    intent: input.request.intent,
    text: input.generatedText,
    chatState,
    random: input.deps.random
  });

  input.logger.debug('tts_decision_evaluated', {
    intent: input.request.intent,
    reason: decision.reason,
    shouldAttempt: decision.shouldAttempt,
    speechTextLength: decision.shouldAttempt ? decision.speechText.length : null
  });

  if (!decision.shouldAttempt) {
    updateAnswerTtsStateAfterText({
      deps: input.deps,
      chatId: input.request.chatId,
      wasEligible:
        input.request.intent === 'answer' &&
        (decision.reason === 'cadence' || decision.reason === 'probability')
    });

    const sent = await dispatchTextReply({
      deps: input.deps,
      request: input.request,
      text: input.formattedText
    });

    return { outputMode: 'text', sent };
  }

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
      filename: `reply-${input.request.triggerMessageId}.ogg`,
      mimeType: synthesized.mimeType
    });

    updateAnswerTtsStateAfterVoice({
      deps: input.deps,
      chatId: input.request.chatId
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

    input.logger.debug('tts_voice_sent', {
      intent: input.request.intent,
      provider: synthesized.provider,
      providerModel: synthesized.providerModel,
      audioBytes: synthesized.audioBytes.byteLength
    });

    return { outputMode: 'voice', sent };
  } catch (error) {
    input.logger.warn('tts_synthesis_failed', {
      intent: input.request.intent,
      ...serializeError(error)
    });

    const sent = await dispatchTextReply({
      deps: input.deps,
      request: input.request,
      text: input.formattedText
    });

    return { outputMode: 'text', sent };
  }
}

export async function dispatchTextReply(input: {
  deps: ChatOrchestratorDeps;
  request: ReplyRequest;
  text: string;
}): Promise<SentBotMessage> {
  const sent = await input.deps.replyDispatcher({
    chatId: input.request.chatId,
    replyToMessageId: input.request.triggerMessageId,
    text: input.text
  });

  input.deps.db.saveBotMessage({
    chatId: input.request.chatId,
    chatType: input.request.chatType,
    chatTitle: input.request.chatTitle,
    messageId: sent.messageId,
    text: input.text,
    createdAt: sent.createdAt,
    userId: input.deps.bot.userId,
    username: input.deps.bot.username,
    displayName: input.deps.bot.displayName,
    replyToMessageId: input.request.triggerMessageId,
    outputMode: 'text'
  });

  return sent;
}

export function updateAnswerTtsStateAfterText(input: {
  deps: Pick<ChatOrchestratorDeps, 'db'>;
  chatId: number;
  wasEligible: boolean;
}): void {
  if (!input.wasEligible) {
    return;
  }

  const chatState = input.deps.db.getChatState(input.chatId);

  input.deps.db.updateChatTtsState({
    chatId: input.chatId,
    answerLastOutputMode: 'text',
    answerEligibleTextSinceVoice:
      (chatState?.answerEligibleTextSinceVoice ?? 0) + 1,
    answerEligibleTextStreak: (chatState?.answerEligibleTextStreak ?? 0) + 1
  });
}

export function updateAnswerTtsStateAfterVoice(input: {
  deps: Pick<ChatOrchestratorDeps, 'db'>;
  chatId: number;
}): void {
  input.deps.db.updateChatTtsState({
    chatId: input.chatId,
    answerLastOutputMode: 'voice',
    answerEligibleTextSinceVoice: 0,
    answerEligibleTextStreak: 0
  });
}
