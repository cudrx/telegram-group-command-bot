import { Bot } from "grammy";

import type { AppEnv } from "./config/env.js";
import { loadPersona } from "./config/persona.js";
import { createLogger, serializeError } from "./logging/logger.js";
import { OpenAiCompatibleLlmClient } from "./llm/openai-compatible-llm-client.js";
import { DatabaseClient } from "./storage/database.js";
import { normalizeTextMessage } from "./transport/telegram/normalize-message.js";
import { ChatOrchestrator } from "./app/chat-orchestrator.js";

export type Application = {
  start(): Promise<void>;
  stop(): Promise<void>;
};

export async function createApplication(env: AppEnv): Promise<Application> {
  const db = DatabaseClient.open(env.sqlitePath);
  const qwen = new OpenAiCompatibleLlmClient({
    apiKey: env.llmApiKey,
    baseUrl: env.llmBaseUrl,
    replyModel: env.llmReplyModel,
    summaryModel: env.llmSummaryModel,
    timeoutMs: env.llmTimeoutMs,
    maxRetries: env.llmMaxRetries
  });
  const bot = new Bot(env.telegramBotToken);
  const botInfo = await bot.api.getMe();
  const logger = createLogger({
    service: "telegram-character-bot",
    nodeEnv: env.nodeEnv
  });
  logger.info("bot_initialized", {
    botUserId: botInfo.id,
    botUsername: botInfo.username ?? null
  });
  const orchestrator = new ChatOrchestrator({
    db,
    qwen,
    env,
    bot: {
      userId: botInfo.id,
      username: botInfo.username ?? null,
      displayName: botInfo.first_name ?? botInfo.username ?? "Bot"
    },
    replyDispatcher: async ({ chatId, replyToMessageId, text }) => {
      const sent = await bot.api.sendMessage(chatId, text, {
        reply_parameters: {
          message_id: replyToMessageId
        }
      });

      return {
        messageId: sent.message_id,
        createdAt: new Date(sent.date * 1000).toISOString()
      };
    },
    loadPersona,
    logger,
    random: Math.random,
    now: () => new Date().toISOString()
  });
  let summarySweepTimer: NodeJS.Timeout | null = null;

  bot.use(async (ctx, next) => {
    const message = ctx.update.message;

    logger.info("telegram_update_received", {
      updateId: ctx.update.update_id,
      updateKinds: Object.keys(ctx.update).filter((key) => key !== "update_id"),
      hasMessageText: Boolean(message?.text),
      chatId: message?.chat?.id,
      chatType: message?.chat?.type,
      messageId: message?.message_id,
      messageKeys: message ? Object.keys(message).sort() : []
    });

    await next();
  });

  bot.catch((error) => {
    logger.error("telegram_update_failed", {
      ...serializeError(error),
      updateId: error.ctx?.update?.update_id ?? null
    });
  });

  bot.on("message:text", async (ctx) => {
    const normalized = normalizeTextMessage(ctx);

    if (!normalized || normalized.isBot) {
      return;
    }

    logger.info("incoming_message_received", {
      chatId: normalized.chatId,
      messageId: normalized.messageId,
      chatType: normalized.chatType,
      fromUserId: normalized.fromUserId,
      hasMention: normalized.entities.some((entity) => entity.type === "mention"),
      isReplyToBot: normalized.replyToUserId === botInfo.id
    });

    await orchestrator.handleIncomingMessage(normalized);
  });

  return {
    async start() {
      summarySweepTimer = setInterval(() => {
        void orchestrator.runIdleSummarySweep();
      }, env.summarySweepIntervalMs);
      summarySweepTimer.unref();

      logger.info("bot_polling_started", {
        allowedUpdates: ["message"]
      });

      await bot.start({
        allowed_updates: ["message"]
      });
    },

    async stop() {
      if (summarySweepTimer) {
        clearInterval(summarySweepTimer);
      }

      bot.stop();
      db.close();
    }
  };
}
