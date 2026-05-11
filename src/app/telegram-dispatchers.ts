import { InputFile, InputMediaBuilder } from 'grammy';
import type {
  MemeDispatcher,
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
  sendPhoto(
    chatId: number,
    file: InputFile,
    options?: Record<string, unknown>
  ): Promise<TelegramSentMessage>;
  sendVideo(
    chatId: number,
    file: InputFile,
    options?: Record<string, unknown>
  ): Promise<TelegramSentMessage>;
  sendAnimation(
    chatId: number,
    file: InputFile,
    options?: Record<string, unknown>
  ): Promise<TelegramSentMessage>;
  sendMediaGroup(
    chatId: number,
    media: ReturnType<typeof InputMediaBuilder.photo>[],
    options?: Record<string, unknown>
  ): Promise<TelegramSentMessage[]>;
  sendChatAction(chatId: number, action: TelegramChatAction): Promise<unknown>;
};

export type TelegramDispatchers = {
  replyDispatcher: ReplyDispatcher;
  voiceDispatcher: VoiceDispatcher;
  weeklyDispatcher: WeeklyDispatcher;
  memeDispatcher: MemeDispatcher;
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
  const memeDispatcher: MemeDispatcher = async ({
    chatId,
    replyToMessageId,
    caption,
    media
  }) => {
    const replyParameters = {
      reply_parameters: {
        message_id: replyToMessageId
      }
    };

    if (media.kind === 'image') {
      const sent = await api.sendPhoto(chatId, new InputFile(media.filePath), {
        caption,
        parse_mode: 'HTML',
        ...replyParameters
      });

      return toSentBotMessage(sent);
    }

    if (media.kind === 'video') {
      const sent = await api.sendVideo(chatId, new InputFile(media.filePath), {
        caption,
        parse_mode: 'HTML',
        ...replyParameters
      });

      return toSentBotMessage(sent);
    }

    if (media.kind === 'animation') {
      const sent = await api.sendAnimation(
        chatId,
        new InputFile(media.filePath),
        {
          caption,
          parse_mode: 'HTML',
          ...replyParameters
        }
      );

      return toSentBotMessage(sent);
    }

    const group = media.files.map((file, index) =>
      InputMediaBuilder.photo(new InputFile(file.filePath), {
        ...(index === 0 ? { caption, parse_mode: 'HTML' } : {})
      })
    );
    const sent = await api.sendMediaGroup(chatId, group, replyParameters);
    const first = sent[0];

    if (!first) {
      throw new Error('Telegram sendMediaGroup returned no messages.');
    }

    return toSentBotMessage(first);
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
    memeDispatcher,
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
