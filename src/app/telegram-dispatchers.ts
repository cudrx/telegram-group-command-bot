import { InputFile } from 'grammy';
import type {
  ReplyDispatcher,
  SentBotMessage,
  VoiceDispatcher,
  WeeklyDispatcher
} from './chat-orchestrator/types.js';
import type { TelegramChatAction } from './typing-indicator.js';

type TelegramSentMessage = {
  message_id: number;
  date: number;
};

type TelegramApi = {
  sendMessage(
    chatId: number,
    text: string,
    options?: Record<string, unknown>
  ): Promise<TelegramSentMessage>;
  sendVoice(
    chatId: number,
    file: InputFile,
    options?: Record<string, unknown>
  ): Promise<TelegramSentMessage>;
  sendChatAction(chatId: number, action: TelegramChatAction): Promise<unknown>;
};

export type TelegramDispatchers = {
  replyDispatcher: ReplyDispatcher;
  voiceDispatcher: VoiceDispatcher;
  weeklyDispatcher: WeeklyDispatcher;
  sendChatAction: (chatId: number, action: TelegramChatAction) => Promise<void>;
  sendHtmlMessage: (input: {
    chatId: number;
    text: string;
  }) => Promise<SentBotMessage>;
};

export function createTelegramDispatchers(
  api: TelegramApi
): TelegramDispatchers {
  const sendHtmlMessage = async (input: {
    chatId: number;
    text: string;
  }): Promise<SentBotMessage> => {
    const sent = await api.sendMessage(input.chatId, input.text, {
      parse_mode: 'HTML'
    });

    return toSentBotMessage(sent);
  };

  return {
    replyDispatcher: async ({ chatId, replyToMessageId, text }) => {
      const sent = await api.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_parameters: {
          message_id: replyToMessageId
        }
      });

      return toSentBotMessage(sent);
    },
    voiceDispatcher: async ({
      chatId,
      replyToMessageId,
      audioBytes,
      filename
    }) => {
      const sent = await api.sendVoice(
        chatId,
        new InputFile(audioBytes, filename),
        {
          reply_parameters: {
            message_id: replyToMessageId
          }
        }
      );

      return toSentBotMessage(sent);
    },
    weeklyDispatcher: sendHtmlMessage,
    sendChatAction: async (chatId, action) => {
      await api.sendChatAction(chatId, action);
    },
    sendHtmlMessage
  };
}

function toSentBotMessage(sent: TelegramSentMessage): SentBotMessage {
  return {
    messageId: sent.message_id,
    createdAt: new Date(sent.date * 1000).toISOString()
  };
}
