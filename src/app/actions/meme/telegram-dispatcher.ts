import type { MemeDispatcher } from '../../chat-orchestrator/types.js';
import type { DownloadedMemeMedia, SentMemeMedia } from './types.js';

export async function dispatchMemeMedia(input: {
  memeDispatcher: MemeDispatcher;
  chatId: number;
  replyToMessageId: number;
  caption: string;
  media: DownloadedMemeMedia;
}): Promise<SentMemeMedia> {
  const sent = await input.memeDispatcher({
    chatId: input.chatId,
    replyToMessageId: input.replyToMessageId,
    caption: input.caption,
    media: toDispatchMedia(input.media)
  });

  return {
    messageId: sent.messageId,
    createdAt: sent.createdAt,
    mediaSnapshot: sent.mediaSnapshot ?? null
  };
}

function toDispatchMedia(media: DownloadedMemeMedia): {
  kind: 'image' | 'video';
  filePath: string;
} {
  if (media.kind !== 'image' && media.kind !== 'video') {
    const unsupported = media as { kind?: string };

    throw new Error(
      `Unsupported meme media kind for Telegram dispatch: ${unsupported.kind}.`
    );
  }

  return {
    kind: media.kind,
    filePath: media.filePath
  };
}
