import { InputFile } from 'grammy';
import type { InputMediaPhoto } from 'grammy/types';
import type { MediaMessageSnapshot } from '../domain/models.js';
import type {
  DeleteMessageDispatcher,
  EditMessageTextDispatcher,
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

type TelegramApi = {
  sendMessage(
    chatId: number,
    text: string,
    options?: Record<string, unknown>
  ): Promise<TelegramSentMessage>;
  editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    options?: Record<string, unknown>
  ): Promise<TelegramSentMessage | true>;
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
  deleteMessage(chatId: number, messageId: number): Promise<unknown>;
  sendChatAction(chatId: number, action: TelegramChatAction): Promise<unknown>;
};

export type TelegramDispatchers = {
  replyDispatcher: ReplyDispatcher;
  voiceDispatcher: VoiceDispatcher;
  memeDispatcher: MemeDispatcher;
  editMessageTextDispatcher: EditMessageTextDispatcher;
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
      const sentBatches = await sendTelegramGalleryMedia({
        api,
        chatId,
        items: media.items,
        caption,
        replyParameters
      });
      const firstSent = sentBatches[0]?.[0];
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
        ? await api.sendVideo(chatId, new InputFile(media.filePath), {
            ...options,
            ...toTelegramVideoOptions(media)
          })
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
    editMessageTextDispatcher: async ({ chatId, messageId, text }) => {
      await api.editMessageText(chatId, messageId, text, {
        parse_mode: 'HTML',
        link_preview_options: {
          is_disabled: true
        }
      });
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

async function sendTelegramGalleryMedia(input: {
  api: Pick<TelegramApi, 'sendMediaGroup'>;
  chatId: number;
  items: Array<{ filePath: string; hasSpoiler?: boolean }>;
  caption: string;
  replyParameters: Record<string, unknown>;
}): Promise<TelegramSentMessage[][]> {
  const chunks = chunkGalleryItems(input.items, 10);
  const sentBatches: TelegramSentMessage[][] = [];

  for (const [index, chunk] of chunks.entries()) {
    const sent = await input.api.sendMediaGroup(
      input.chatId,
      toTelegramGalleryMedia(chunk, input.caption, {
        includeCaption: index === 0
      }),
      index === 0 ? input.replyParameters : {}
    );
    sentBatches.push(sent);
  }

  return sentBatches;
}

function toTelegramGalleryMedia(
  items: Array<{ filePath: string; hasSpoiler?: boolean }>,
  caption: string,
  options: { includeCaption: boolean }
): InputMediaPhoto[] {
  return items.map((item, index) => ({
    type: 'photo',
    media: new InputFile(item.filePath),
    ...(options.includeCaption && index === 0
      ? { caption, parse_mode: 'HTML' }
      : {}),
    ...(item.hasSpoiler ? { has_spoiler: true } : {})
  }));
}

function chunkGalleryItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
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

function toTelegramVideoOptions(media: {
  durationSeconds?: number | null;
  width?: number | null;
  height?: number | null;
}): Record<string, unknown> {
  return {
    supports_streaming: true,
    ...toTelegramPositiveInteger('duration', media.durationSeconds),
    ...toTelegramPositiveInteger('width', media.width),
    ...toTelegramPositiveInteger('height', media.height)
  };
}

function toTelegramPositiveInteger(
  key: string,
  value: number | null | undefined
): Record<string, number> {
  if (value == null || !Number.isFinite(value) || value <= 0) return {};

  return { [key]: Math.round(value) };
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
