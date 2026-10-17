import type { MemeDispatcher } from '../../chat-orchestrator/types.js';
import type { DownloadedMemeMedia, SentMemeMedia } from './types.js';

export async function dispatchMemeMedia(input: {
  memeDispatcher: MemeDispatcher;
  chatId: number;
  replyToMessageId?: number | null;
  reply?: boolean;
  caption: string;
  hasSpoiler?: boolean;
  media: DownloadedMemeMedia;
}): Promise<SentMemeMedia> {
  const dispatchInput: Parameters<MemeDispatcher>[0] = {
    chatId: input.chatId,
    caption: input.caption,
    media: toDispatchMedia(input.media)
  };

  if (input.replyToMessageId !== undefined) {
    dispatchInput.replyToMessageId = input.replyToMessageId;
  }

  if (input.reply !== undefined) {
    dispatchInput.reply = input.reply;
  }

  if (input.hasSpoiler !== undefined) {
    dispatchInput.hasSpoiler = input.hasSpoiler;
  }

  const sent = await input.memeDispatcher({
    ...dispatchInput
  });

  return {
    messageId: sent.messageId,
    createdAt: sent.createdAt,
    mediaSnapshot: sent.mediaSnapshot ?? null
  };
}

function toDispatchMedia(media: DownloadedMemeMedia):
  | {
      kind: 'image' | 'animation';
      filePath: string;
    }
  | {
      kind: 'video';
      filePath: string;
      durationSeconds?: number | null;
      width?: number | null;
      height?: number | null;
    }
  | {
      kind: 'gallery';
      items: Array<
        | { kind?: 'image'; filePath: string; hasSpoiler?: boolean }
        | {
            kind: 'video';
            filePath: string;
            durationSeconds?: number | null;
            width?: number | null;
            height?: number | null;
            hasSpoiler?: boolean;
          }
      >;
    } {
  if (media.kind === 'gallery') {
    return {
      kind: 'gallery',
      items: media.items.map((item) =>
        item.kind === 'video'
          ? {
              kind: 'video' as const,
              filePath: item.filePath,
              ...(item.durationSeconds !== undefined
                ? { durationSeconds: item.durationSeconds }
                : {}),
              ...(item.width !== undefined ? { width: item.width } : {}),
              ...(item.height !== undefined ? { height: item.height } : {}),
              ...(item.hasSpoiler ? { hasSpoiler: true } : {})
            }
          : {
              filePath: item.filePath,
              ...(item.hasSpoiler ? { hasSpoiler: true } : {})
            }
      )
    };
  }

  if (media.kind === 'video') {
    return {
      kind: 'video',
      filePath: media.filePath,
      ...(media.durationSeconds !== undefined
        ? { durationSeconds: media.durationSeconds }
        : {}),
      ...(media.width !== undefined ? { width: media.width } : {}),
      ...(media.height !== undefined ? { height: media.height } : {})
    };
  }

  return {
    kind: media.kind,
    filePath: media.filePath
  };
}
