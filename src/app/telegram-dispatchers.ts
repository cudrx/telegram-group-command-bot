import { InputFile } from 'grammy';
import type { MediaMessageSnapshot } from '../domain/models.js';
import type {
  CopiedBotMessage,
  CopyMessageDispatcher,
  CopyMessagesDispatcher,
  MemeDispatcher,
  ReplyDispatcher,
  SentBotMessage,
  VoiceDispatcher
} from './chat-orchestrator/types.js';
import type { TelegramChatAction } from './typing-indicator.js';

type TelegramSentMessage = {
  message_id: number;
  date: number;
  photo?: Array<{
    file_id: string;
    file_unique_id?: string;
    file_size?: number;
  }>;
};

type TelegramMessageId = {
  message_id: number;
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
  copyMessage(
    chatId: number,
    fromChatId: number,
    messageId: number,
    options?: Record<string, unknown>
  ): Promise<TelegramMessageId>;
  copyMessages(
    chatId: number,
    fromChatId: number,
    messageIds: number[],
    options?: Record<string, unknown>
  ): Promise<TelegramMessageId[]>;
  sendChatAction(chatId: number, action: TelegramChatAction): Promise<unknown>;
};

export type TelegramDispatchers = {
  replyDispatcher: ReplyDispatcher;
  voiceDispatcher: VoiceDispatcher;
  memeDispatcher: MemeDispatcher;
  copyMessageDispatcher: CopyMessageDispatcher;
  copyMessagesDispatcher: CopyMessagesDispatcher;
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
    const linkPreviewOptions = {
      link_preview_options: {
        is_disabled: true
      }
    };

    const sent = await api.sendPhoto(chatId, new InputFile(media.filePath), {
      caption,
      parse_mode: 'HTML',
      ...linkPreviewOptions,
      ...replyParameters
    });
    const mediaSnapshot = toSentPhotoSnapshot(sent, caption);

    return {
      ...toSentBotMessage(sent),
      ...(mediaSnapshot ? { mediaSnapshot } : {})
    };
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
    memeDispatcher,
    copyMessageDispatcher: async ({
      targetChatId,
      sourceChatId,
      messageId
    }) => {
      const copied = await api.copyMessage(
        targetChatId,
        sourceChatId,
        messageId
      );

      return toCopiedBotMessage(copied);
    },
    copyMessagesDispatcher: async ({
      targetChatId,
      sourceChatId,
      messageIds
    }) => {
      const copied = await api.copyMessages(
        targetChatId,
        sourceChatId,
        messageIds
      );

      return copied.map(toCopiedBotMessage);
    },
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

function toCopiedBotMessage(sent: TelegramMessageId): CopiedBotMessage {
  return {
    messageId: sent.message_id
  };
}

function toSentPhotoSnapshot(
  sent: TelegramSentMessage,
  caption: string
): MediaMessageSnapshot | null {
  const photo = sent.photo?.at(-1);

  if (!photo) return null;

  return {
    messageId: sent.message_id,
    mediaKind: 'photo',
    fileId: photo.file_id,
    fileUniqueId: photo.file_unique_id ?? null,
    mimeType: 'image/jpeg',
    fileSize: photo.file_size ?? null,
    durationSeconds: null,
    caption
  };
}
