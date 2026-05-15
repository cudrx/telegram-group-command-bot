import { InputFile } from 'grammy';
import type { MediaMessageSnapshot } from '../domain/models.js';
import type {
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
  sendAnimation(
    chatId: number,
    file: InputFile,
    options?: Record<string, unknown>
  ): Promise<TelegramSentMessage>;
  sendChatAction(chatId: number, action: TelegramChatAction): Promise<unknown>;
};

export type TelegramDispatchers = {
  replyDispatcher: ReplyDispatcher;
  voiceDispatcher: VoiceDispatcher;
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
    const linkPreviewOptions = {
      link_preview_options: {
        is_disabled: true
      }
    };

    if (media.kind === 'image') {
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
    }

    const sent = await api.sendAnimation(
      chatId,
      new InputFile(media.filePath),
      {
        caption,
        parse_mode: 'HTML',
        ...linkPreviewOptions,
        ...replyParameters
      }
    );

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
