import { InputFile } from 'grammy';
import type { InputMediaPhoto } from 'grammy/types';
import type { MediaMessageSnapshot } from '../domain/models.js';
import type {
  CopiedBotMessage,
  CopyMessageDispatcher,
  CopyMessagesDispatcher,
  DeleteMessageDispatcher,
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
  video?: {
    file_id: string;
    file_unique_id?: string;
    mime_type?: string;
    file_size?: number;
    duration?: number;
  };
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
  sendVideo(
    chatId: number,
    file: InputFile,
    options?: Record<string, unknown>
  ): Promise<TelegramSentMessage>;
  sendMediaGroup(
    chatId: number,
    media: ReadonlyArray<InputMediaPhoto>,
    options?: Record<string, unknown>
  ): Promise<TelegramSentMessage[]>;
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
  deleteMessage(chatId: number, messageId: number): Promise<unknown>;
  sendChatAction(chatId: number, action: TelegramChatAction): Promise<unknown>;
};

export type TelegramDispatchers = {
  replyDispatcher: ReplyDispatcher;
  voiceDispatcher: VoiceDispatcher;
  memeDispatcher: MemeDispatcher;
  copyMessageDispatcher: CopyMessageDispatcher;
  copyMessagesDispatcher: CopyMessagesDispatcher;
  deleteMessageDispatcher: DeleteMessageDispatcher;
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
    reply,
    caption,
    hasSpoiler,
    media
  }) => {
    const replyParameters = createReplyParameters({
      replyToMessageId,
      reply
    });
    const linkPreviewOptions = {
      link_preview_options: {
        is_disabled: true
      }
    };

    if (media.kind === 'gallery') {
      const sent = await api.sendMediaGroup(
        chatId,
        toTelegramGalleryMedia(media.items, caption),
        replyParameters
      );
      const firstSent = sent[0];
      const mediaSnapshot = firstSent
        ? toSentPhotoSnapshot(firstSent, caption)
        : null;

      return {
        ...toSentBotMessage(firstSent ?? { message_id: 0, date: 0 }),
        ...(mediaSnapshot ? { mediaSnapshot } : {})
      };
    }

    const options = {
      caption,
      parse_mode: 'HTML',
      ...(hasSpoiler ? { has_spoiler: true } : {}),
      ...linkPreviewOptions,
      ...replyParameters
    };
    const sent =
      media.kind === 'video'
        ? await api.sendVideo(chatId, new InputFile(media.filePath), options)
        : await api.sendPhoto(chatId, new InputFile(media.filePath), options);
    const mediaSnapshot =
      media.kind === 'video'
        ? toSentVideoSnapshot(sent, caption)
        : toSentPhotoSnapshot(sent, caption);

    return {
      ...toSentBotMessage(sent),
      ...(mediaSnapshot ? { mediaSnapshot } : {})
    };
  };

  return {
    replyDispatcher: async ({ chatId, replyToMessageId, reply, text }) => {
      const sent = await api.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        ...createReplyParameters({ replyToMessageId, reply })
      });

      return toSentBotMessage(sent);
    },
    voiceDispatcher: async ({
      chatId,
      replyToMessageId,
      reply,
      audioBytes,
      filename
    }) => {
      const sent = await api.sendVoice(
        chatId,
        new InputFile(audioBytes, filename),
        createReplyParameters({ replyToMessageId, reply })
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
    deleteMessageDispatcher: async ({ chatId, messageId }) => {
      await api.deleteMessage(chatId, messageId);
    },
    sendChatAction: async (chatId, action) => {
      await api.sendChatAction(chatId, action);
    },
    sendHtmlMessage
  };
}

function toTelegramGalleryMedia(
  items: Array<{ filePath: string; hasSpoiler?: boolean }>,
  caption: string
): InputMediaPhoto[] {
  return items.map((item, index) => ({
    type: 'photo',
    media: new InputFile(item.filePath),
    ...(index === 0 ? { caption, parse_mode: 'HTML' } : {}),
    ...(item.hasSpoiler ? { has_spoiler: true } : {})
  }));
}

function createReplyParameters(input: {
  replyToMessageId: number | null | undefined;
  reply: boolean | undefined;
}): Record<string, unknown> {
  if (input.reply === false || input.replyToMessageId == null) return {};

  return {
    reply_parameters: {
      message_id: input.replyToMessageId
    }
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

function toSentVideoSnapshot(
  sent: TelegramSentMessage,
  caption: string
): MediaMessageSnapshot | null {
  const video = sent.video;

  if (!video) return null;

  return {
    messageId: sent.message_id,
    mediaKind: 'video',
    fileId: video.file_id,
    fileUniqueId: video.file_unique_id ?? null,
    mimeType: video.mime_type ?? 'video/mp4',
    fileSize: video.file_size ?? null,
    durationSeconds: video.duration ?? null,
    caption
  };
}
