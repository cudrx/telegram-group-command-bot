import { Bot } from 'grammy';
import { ChatOrchestrator } from './app/chat-orchestrator/index.js';
import { maybeAnnounceDeployUpdate } from './app/deploy-announcer.js';
import type { AppEnv } from './config/env.js';
import { OpenAiCompatibleLlmClient } from './llm/openai-compatible-client/index.js';
import { createLogger, serializeError } from './logging/logger.js';
import { TavilyLookupProvider } from './lookup/tavily-lookup-provider.js';
import { CloudflareVisionProvider } from './media/cloudflare-vision-provider.js';
import { GladiaTranscriptionProvider } from './media/gladia-transcription-provider.js';
import { OcrSpaceProvider } from './media/ocr-space-provider.js';
import { DatabaseClient } from './database/index.js';
import { normalizeTextMessage } from './transport/telegram/normalize-message.js';

export type Application = {
  start(): Promise<void>;
  stop(): Promise<void>;
};

export async function createApplication(env: AppEnv): Promise<Application> {
  const db = DatabaseClient.open(env.sqlitePath);
  const logger = createLogger(
    {
      service: 'telegram-assistant-bot',
      nodeEnv: env.nodeEnv
    },
    {
      level: env.logLevel,
      color: env.logColor
    }
  );
  const qwen = new OpenAiCompatibleLlmClient(
    {
      apiKey: env.llmApiKey,
      baseUrl: env.llmBaseUrl,
      replyModel: env.llmReplyModel,
      replyTemperature: env.llmReplyTemperature,
      replyEnableThinking: env.llmReplyEnableThinking,
      plannerModel: env.llmPlannerModel,
      lookupMaxQueries: env.lookupMaxQueries,
      timeoutMs: env.llmTimeoutMs,
      maxRetries: env.llmMaxRetries
    },
    undefined,
    {
      logger: logger.child({
        component: 'llm'
      }),
      logLlmText: env.logLlmText
    }
  );
  const lookupProvider =
    env.lookupEnabled && env.lookupProvider === 'tavily' && env.tavilyApiKey
      ? new TavilyLookupProvider({ apiKey: env.tavilyApiKey })
      : null;
  const speechToTextProvider =
    env.mediaAnalysisEnabled && env.sttProvider === 'gladia' && env.gladiaApiKey
      ? new GladiaTranscriptionProvider({ apiKey: env.gladiaApiKey })
      : null;
  const visionProvider =
    env.mediaAnalysisEnabled &&
    env.visionProvider === 'cloudflare' &&
    env.cloudflareAiApiKey &&
    env.cloudflareAccountId
      ? new CloudflareVisionProvider({
          accountId: env.cloudflareAccountId,
          apiKey: env.cloudflareAiApiKey
        })
      : null;
  const ocrProvider =
    env.mediaAnalysisEnabled && env.ocrSpaceApiKey
      ? new OcrSpaceProvider({ apiKey: env.ocrSpaceApiKey })
      : null;
  const bot = new Bot(env.telegramBotToken);
  const botInfo = await bot.api.getMe();
  logger.info('bot_initialized', {
    botUserId: botInfo.id,
    botUsername: botInfo.username ?? null
  });
  const orchestrator = new ChatOrchestrator({
    db,
    qwen,
    env,
    lookupProvider,
    speechToTextProvider,
    ocrProvider,
    visionProvider,
    telegramFileApi: bot.api,
    fetch: globalThis.fetch,
    bot: {
      userId: botInfo.id,
      username: botInfo.username ?? null,
      displayName: botInfo.first_name ?? botInfo.username ?? 'Bot'
    },
    replyDispatcher: async ({ chatId, replyToMessageId, text }) => {
      const sent = await bot.api.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_parameters: {
          message_id: replyToMessageId
        }
      });

      return {
        messageId: sent.message_id,
        createdAt: new Date(sent.date * 1000).toISOString()
      };
    },
    sendTyping: async (chatId) => {
      await bot.api.sendChatAction(chatId, 'typing');
    },
    delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    logger,
    random: Math.random,
    now: () => new Date().toISOString()
  });
  let cleanupTimer: ReturnType<typeof setInterval> | null = null;

  const runCleanup = () => {
    const deleted = db.cleanupExpiredData({
      now: new Date().toISOString(),
      messageRetentionDays: env.messageRetentionDays,
      mediaArtifactRetentionDays: env.mediaArtifactRetentionDays
    });

    logger.debug('database_cleanup_completed', deleted);
  };
  bot.use(async (ctx, next) => {
    const message = ctx.update.message;

    logger.debug('telegram_update_received', {
      updateId: ctx.update.update_id,
      updateKinds: Object.keys(ctx.update).filter((key) => key !== 'update_id'),
      hasMessageText: Boolean(message?.text),
      hasMessageCaption: Boolean(message?.caption),
      chatId: message?.chat?.id,
      chatType: message?.chat?.type,
      messageId: message?.message_id,
      messageKeys: message ? Object.keys(message).sort() : []
    });

    await next();
  });

  bot.catch((error) => {
    logger.error('telegram_update_failed', {
      ...serializeError(error),
      updateId: error.ctx?.update?.update_id ?? null
    });
  });

  bot.on('message', async (ctx) => {
    const normalized = normalizeTextMessage(ctx);

    if (!normalized || normalized.fromUserId === botInfo.id) {
      return;
    }

    logger.debug('incoming_message_received', {
      chatId: normalized.chatId,
      messageId: normalized.messageId,
      chatType: normalized.chatType,
      fromUserId: normalized.fromUserId,
      hasMention: normalized.entities.some(
        (entity) => entity.type === 'mention'
      )
    });

    await orchestrator.handleIncomingMessage(normalized);
  });

  return {
    async start() {
      runCleanup();
      cleanupTimer = setInterval(
        runCleanup,
        env.databaseCleanupIntervalHours * 60 * 60 * 1000
      );
      cleanupTimer.unref?.();

      await maybeAnnounceDeployUpdate({
        deployNotifyChatId: env.deployNotifyChatId,
        db,
        llm: qwen,
        sendMessage: async ({ chatId, text }) => {
          await bot.api.sendMessage(chatId, text, {
            parse_mode: 'HTML'
          });
        },
        logger,
        now: () => new Date().toISOString()
      });

      logger.info('bot_polling_started', {
        allowedUpdates: ['message']
      });

      await bot.start({
        allowed_updates: ['message']
      });
    },

    async stop() {
      if (cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
      }

      bot.stop();
      db.close();
    }
  };
}
