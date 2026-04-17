import { Bot } from "grammy";

import type { AppEnv } from "./config/env.js";
import { loadAssistantInstructions } from "./config/assistant-instructions.js";
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
  const logger = createLogger({
    service: "telegram-assistant-bot",
    nodeEnv: env.nodeEnv
  }, {
    level: env.logLevel,
    color: env.logColor
  });
  const qwen = new OpenAiCompatibleLlmClient({
    apiKey: env.llmApiKey,
    baseUrl: env.llmBaseUrl,
    replyModel: env.llmReplyModel,
    replyTemperature: env.llmReplyTemperature,
    timeoutMs: env.llmTimeoutMs,
    maxRetries: env.llmMaxRetries
  }, undefined, {
    logger: logger.child({
      component: "llm"
    }),
    logLlmText: env.logLlmText
  });
  const bot = new Bot(env.telegramBotToken);
  const botInfo = await bot.api.getMe();
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
        parse_mode: "HTML",
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
      await bot.api.sendChatAction(chatId, "typing");
    },
    delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    loadAssistantInstructions,
    logger,
    random: Math.random,
    now: () => new Date().toISOString()
  });
  bot.use(async (ctx, next) => {
    const message = ctx.update.message;

    logger.debug("telegram_update_received", {
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

    if (!normalized || normalized.fromUserId === botInfo.id) {
      return;
    }

    logger.debug("incoming_message_received", {
      chatId: normalized.chatId,
      messageId: normalized.messageId,
      chatType: normalized.chatType,
      fromUserId: normalized.fromUserId,
      hasMention: normalized.entities.some((entity) => entity.type === "mention")
    });

    await orchestrator.handleIncomingMessage(normalized);
  });

  return {
    async start() {
      logger.info("bot_polling_started", {
        allowedUpdates: ["message"]
      });

      await bot.start({
        allowed_updates: ["message"]
      });
    },

    async stop() {
      bot.stop();
      db.close();
    }
  };
}
