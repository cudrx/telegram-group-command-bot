import type { MemeDispatcher } from '../types.js';
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
    createdAt: sent.createdAt
  };
}

function toDispatchMedia(
  media: DownloadedMemeMedia
):
  | { kind: 'image'; filePath: string }
  | { kind: 'video'; filePath: string }
  | { kind: 'animation'; filePath: string }
  | { kind: 'gallery'; files: Array<{ filePath: string }> } {
  if (media.kind === 'gallery') {
    return {
      kind: 'gallery',
      files: media.files.map((file) => ({ filePath: file.filePath }))
    };
  }

  return {
    kind: media.kind,
    filePath: media.filePath
  };
}
