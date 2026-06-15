import { Bot } from 'grammy';
import { resolveAccessContext } from './app/access-policy.js';
import {
  createAdminNotifier,
  createNotifyingLogger
} from './app/admin-notifier.js';
import { ChatOrchestrator } from './app/chat-orchestrator/index.js';
import { createCleanupScheduler } from './app/database-cleanup.js';
import { maybeAnnounceDeployUpdate } from './app/deploy-announcer.js';
import { createMemeFloodGate } from './app/meme-flood-gate.js';
import { createLlmClient, createOptionalProviders } from './app/providers.js';
import { createTelegramDispatchers } from './app/telegram-dispatchers.js';
import { createVideoJobQueue } from './app/video-job-queue.js';
import type { AppEnv } from './config/env/index.js';
import { memeActionConfig } from './config/runtime/index.js';
import { DatabaseClient } from './database/index.js';
import { createLogger, serializeError } from './logging/logger.js';
import {
  normalizeEditedTextMessage,
  normalizeTextMessage
} from './transport/telegram/normalize-message.js';

type Application = {
  start(): Promise<void>;
  stop(): Promise<void>;
};

export async function createApplication(env: AppEnv): Promise<Application> {
  const db = DatabaseClient.open(env.sqlitePath);
  const baseLogger = createLogger(
    {
      service: 'telegram-assistant-bot',
      nodeEnv: env.nodeEnv
    },
    {
      level: env.logLevel,
      color: env.logColor
    }
  );
  const bot = new Bot(env.telegramBotToken);
  const botInfo = await bot.api.getMe();
  baseLogger.info('bot_initialized', {
    botUserId: botInfo.id,
    botUsername: botInfo.username ?? null
  });
  const adminNotifier = createAdminNotifier({
    adminChatId: env.telegramAdminId,
    sendMessage: async ({ chatId, text }) => {
      await bot.api.sendMessage(chatId, text, {
        parse_mode: 'HTML'
      });
    }
  });
  const logger = createNotifyingLogger(baseLogger, adminNotifier);
  const qwen = createLlmClient({ env, logger });
  const providers = createOptionalProviders(env);
  const telegramDispatchers = createTelegramDispatchers(bot.api);
  const memeFloodGate = createMemeFloodGate();
  const videoJobQueue = createVideoJobQueue({
    maxConcurrentJobs: memeActionConfig.videoQueue.maxConcurrentJobs,
    maxConcurrentJobsPerChat:
      memeActionConfig.videoQueue.maxConcurrentJobsPerChat,
    logger
  });
  const orchestrator = new ChatOrchestrator({
    db,
    qwen,
    env,
    ...providers,
    telegramFileApi: bot.api,
    fetch: globalThis.fetch,
    bot: {
      userId: botInfo.id,
      username: botInfo.username ?? null,
      displayName: botInfo.first_name ?? botInfo.username ?? 'Bot'
    },
    replyDispatcher: telegramDispatchers.replyDispatcher,
    voiceDispatcher: telegramDispatchers.voiceDispatcher,
    memeDispatcher: telegramDispatchers.memeDispatcher,
    editMessageTextDispatcher: telegramDispatchers.editMessageTextDispatcher,
    deleteMessageDispatcher: telegramDispatchers.deleteMessageDispatcher,
    sendChatAction: telegramDispatchers.sendChatAction,
    delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    logger,
    random: Math.random,
    now: () => new Date().toISOString(),
    memeFloodGate,
    videoJobQueue
  });
  const cleanupScheduler = createCleanupScheduler({
    db,
    env,
    logger,
    now: () => new Date().toISOString()
  });
  bot.use(async (ctx, next) => {
    const message = ctx.update.message ?? ctx.update.edited_message;

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

    const accessContext = resolveAccessContext({
      env,
      chatId: normalized.chatId,
      chatType: normalized.chatType,
      fromUserId: normalized.fromUserId
    });

    if (accessContext.kind === 'unauthorized') {
      logger.debug('incoming_message_rejected_by_access_policy', {
        chatId: normalized.chatId,
        chatType: normalized.chatType,
        fromUserId: normalized.fromUserId
      });
      return;
    }

    await orchestrator.handleIncomingMessage({
      ...normalized,
      accessContext
    });
  });

  bot.on('edited_message', async (ctx) => {
    const normalized = normalizeEditedTextMessage(ctx);

    if (!normalized || normalized.fromUserId === botInfo.id) {
      return;
    }

    const accessContext = resolveAccessContext({
      env,
      chatId: normalized.chatId,
      chatType: normalized.chatType,
      fromUserId: normalized.fromUserId
    });

    if (accessContext.kind === 'unauthorized') {
      logger.debug('edited_message_rejected_by_access_policy', {
        chatId: normalized.chatId,
        chatType: normalized.chatType,
        fromUserId: normalized.fromUserId
      });
      return;
    }

    const updated = db.updateIncomingMessageEdit({
      chatId: normalized.chatId,
      messageId: normalized.messageId,
      text: normalized.text,
      editedAt: normalized.editedAt
    });

    logger.debug('edited_message_processed', {
      chatId: normalized.chatId,
      messageId: normalized.messageId,
      updated
    });
  });

  return {
    async start() {
      cleanupScheduler.start();
      const deployAnnouncementChatIds = env.telegramChatPolicies
        .filter((policy) => policy.features.deploy_announcements)
        .map((policy) => policy.chatId);

      if (deployAnnouncementChatIds.length > 0) {
        await maybeAnnounceDeployUpdate({
          telegramChatIds: deployAnnouncementChatIds,
          db,
          llm: qwen,
          sendMessage: async (message) => {
            await telegramDispatchers.sendHtmlMessage(message);
          },
          logger,
          now: () => new Date().toISOString()
        });
      }

      logger.info('bot_polling_started', {
        allowedUpdates: ['message', 'edited_message']
      });

      await bot.start({
        allowed_updates: ['message', 'edited_message']
      });
    },

    async stop() {
      cleanupScheduler.stop();
      bot.stop();
      db.close();
    }
  };
}
