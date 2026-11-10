import { spontaneousConfig } from '../../config/runtime/spontaneous.js';
import type { StoredMessage } from '../../domain/models.js';
import { formatMoscowCurrentDateTime } from '../../llm/current-datetime.js';
import { loadAssistantInstructions } from '../../llm/prompt-files.js';
import { serializeError } from '../../logging/logger.js';
import { hasAssistantMention } from '../assistant-mention.js';
import type {
  ChatOrchestratorDeps,
  IncomingMessage
} from '../chat-orchestrator/types.js';
import { formatTelegramHtmlReply } from '../telegram-html/index.js';
import { generateMarkovDraft } from './markov.js';
import { prepareSpontaneousAttempt } from './policy.js';

const LINK = /https?:\/\/|www\.|t\.me\//i;

type AttemptStage = 'prepare' | 'draft' | 'llm' | 'send' | 'persist';
type NotSentReason =
  | 'no_draft'
  | 'invalid_output'
  | 'model_skip'
  | 'foreground_job'
  | 'context_changed'
  | 'stale'
  | 'recent_bot_output'
  | 'error';

export class SpontaneousMessages {
  private readonly inFlight = new Map<number, { cancelled: boolean }>();
  private readonly foreground = new Map<number, number>();
  private readonly lastNoDraftNotice = new Map<number, number>();

  constructor(private readonly deps: ChatOrchestratorDeps) {}

  async runForeground<T>(chatId: number, run: () => Promise<T>): Promise<T> {
    const pending = this.inFlight.get(chatId);
    if (pending) pending.cancelled = true;

    this.foreground.set(chatId, (this.foreground.get(chatId) ?? 0) + 1);
    try {
      return await run();
    } finally {
      const count = (this.foreground.get(chatId) ?? 1) - 1;
      if (count === 0) this.foreground.delete(chatId);
      else this.foreground.set(chatId, count);
    }
  }

  async tryRun(
    message: IncomingMessage,
    logger: ChatOrchestratorDeps['logger']
  ): Promise<void> {
    const access = message.accessContext;
    if (
      access.kind !== 'configured_chat' ||
      access.policy.chatId !== message.chatId ||
      !access.policy.spontaneous?.enabled ||
      (message.chatType !== 'group' && message.chatType !== 'supergroup') ||
      message.isBot ||
      !message.text.trim() ||
      message.text.trimStart().startsWith('/') ||
      LINK.test(message.text) ||
      hasAssistantMention(message, this.deps.bot.username) ||
      message.replyToUserId === this.deps.bot.userId ||
      this.inFlight.has(message.chatId) ||
      this.foreground.has(message.chatId)
    )
      return;

    const policy = access.policy.spontaneous;
    const token = { cancelled: false };
    this.inFlight.set(message.chatId, token);
    let startedAt: number | null = null;
    let stage: AttemptStage = 'prepare';
    let delivered = false;
    const reportNotSent = (reason: NotSentReason, error?: unknown) => {
      const elapsedMs = startedAt === null ? 0 : Date.now() - startedAt;
      const errorFields = error === undefined ? null : serializeError(error);
      const detail =
        typeof errorFields?.errorMessage === 'string'
          ? ` error=${errorFields.errorMessage.slice(0, 500)}`
          : '';
      const fields = {
        ...(errorFields ? { error: errorFields } : {}),
        chatId: message.chatId,
        messageId: message.messageId,
        stage,
        reason,
        elapsedMs,
        message: `chatId=${message.chatId} messageId=${message.messageId} stage=${stage} reason=${reason} elapsedMs=${elapsedMs}${detail}`
      };
      if (reason === 'no_draft') {
        const nowMs = Date.parse(this.deps.now());
        const last = this.lastNoDraftNotice.get(message.chatId);
        if (
          last !== undefined &&
          nowMs - last < policy.cooldownSeconds * 1000
        ) {
          logger.info('spontaneous_not_sent', fields);
          return;
        }
        this.lastNoDraftNotice.set(message.chatId, nowMs);
      }
      logger.warn('spontaneous_not_sent', fields);
    };
    try {
      const now = this.deps.now();
      if (
        !this.isFresh(message, now) ||
        !this.botHasBeenQuiet(message.chatId, now)
      )
        return;

      const history = this.deps.db.getMessagesBefore(
        message.chatId,
        message.messageId + 1,
        spontaneousConfig.corpusLimit
      );
      const samples = history
        .filter((item) => !item.isBot)
        .map((item) => item.text.trim().replace(/\s+/g, ' ').toLowerCase())
        .filter(
          (sample) =>
            sample.length <= spontaneousConfig.maxSampleChars &&
            !sample.startsWith('/') &&
            !LINK.test(sample) &&
            sample.split(' ').length >= 2
        );
      if (new Set(samples).size < spontaneousConfig.minSamples) return;

      const attempt = prepareSpontaneousAttempt({
        db: this.deps.db,
        chatId: message.chatId,
        triggerMessageId: message.messageId,
        now,
        messages: history,
        policy,
        random: this.deps.random
      });
      if (!attempt) return;

      startedAt = Date.now();
      stage = 'draft';
      logger.info('spontaneous_attempt_started', {
        chatId: message.chatId,
        messageId: message.messageId
      });
      const draft = generateMarkovDraft(samples, this.deps.random);
      if (!draft) {
        reportNotSent('no_draft');
        return;
      }
      attempt.reserve();
      const context = recentContext(history, this.deps.bot.userId);
      stage = 'llm';
      const result = await this.deps.qwen.generateSpontaneous({
        assistantInstructions: loadAssistantInstructions(),
        currentDateTime: formatMoscowCurrentDateTime(now),
        draft,
        messages: context
      });
      logger.debug('spontaneous_adapted', {
        action: result.decision.action,
        validOutput: result.validOutput,
        model: result.model,
        latencyMs: result.latencyMs,
        attemptCount: result.attemptCount,
        promptTokensEstimate: result.promptTokensEstimate
      });
      if (!result.validOutput || result.decision.action === 'skip') {
        reportNotSent(result.validOutput ? 'model_skip' : 'invalid_output');
        return;
      }
      const deliveryNow = this.deps.now();
      if (token.cancelled) {
        reportNotSent('foreground_job');

        return;
      }
      if (!this.contextUnchanged(message)) {
        reportNotSent('context_changed');

        return;
      }
      if (!this.isFresh(message, deliveryNow)) {
        reportNotSent('stale');

        return;
      }
      if (!this.botHasBeenQuiet(message.chatId, deliveryNow)) {
        reportNotSent('recent_bot_output');

        return;
      }

      stage = 'send';
      const sent = await this.deps.replyDispatcher({
        chatId: message.chatId,
        reply: false,
        text: formatTelegramHtmlReply(result.decision.text)
      });
      delivered = true;
      stage = 'persist';
      this.deps.db.saveBotMessage({
        chatId: message.chatId,
        chatType: message.chatType,
        chatTitle: message.chatTitle,
        messageId: sent.messageId,
        createdAt: sent.createdAt,
        userId: this.deps.bot.userId,
        username: this.deps.bot.username,
        displayName: this.deps.bot.displayName,
        text: result.decision.text,
        generationKind: 'spontaneous_markov_llm'
      });
      logger.info('spontaneous_sent', { sentMessageId: sent.messageId });
    } catch (error) {
      if (startedAt !== null && !delivered) reportNotSent('error', error);
      else
        logger.warn('spontaneous_failed', {
          ...serializeError(error),
          chatId: message.chatId,
          messageId: message.messageId,
          stage,
          delivered
        });
    } finally {
      this.inFlight.delete(message.chatId);
    }
  }

  private isFresh(message: IncomingMessage, now: string): boolean {
    const age = Date.parse(now) - Date.parse(message.createdAt);

    return age >= 0 && age <= spontaneousConfig.maxTriggerAgeSeconds * 1000;
  }

  private contextUnchanged(message: IncomingMessage): boolean {
    const latest = this.deps.db.getRecentMessages(message.chatId, 1)[0];

    return (
      latest?.messageId === message.messageId && latest.text === message.text
    );
  }

  private botHasBeenQuiet(chatId: number, now: string): boolean {
    const lastBotAt = this.deps.db.getChatState(chatId)?.lastBotMessageAt;

    return (
      !lastBotAt ||
      Date.parse(now) - Date.parse(lastBotAt) >=
        spontaneousConfig.botQuietSeconds * 1000
    );
  }
}

function recentContext(
  history: StoredMessage[],
  botUserId: number
): StoredMessage[] {
  const messages = history
    .filter((message) => !message.isBot || message.userId === botUserId)
    .slice(-spontaneousConfig.contextLimit);
  let remaining: number = spontaneousConfig.maxContextChars;
  const selected: StoredMessage[] = [];
  for (const message of messages.reverse()) {
    if (!message.text.trim()) continue;

    const limit = Math.min(spontaneousConfig.maxContextMessageChars, remaining);
    const marker = ' [message text truncated]';
    if (limit <= marker.length) break;

    const text =
      message.text.length <= limit
        ? message.text
        : `${message.text.slice(0, limit - marker.length)}${marker}`;

    selected.push({ ...message, text });
    remaining -= text.length;
  }

  return selected.reverse();
}
