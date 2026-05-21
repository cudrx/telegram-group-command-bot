import type { MemeDispatcher } from '../../chat-orchestrator/types.js';
import type { DownloadedMemeMedia, SentMemeMedia } from './types.js';

export async function dispatchMemeMedia(input: {
  memeDispatcher: MemeDispatcher;
  chatId: number;
  replyToMessageId?: number | null;
  reply?: boolean;
  caption: string;
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

  const sent = await input.memeDispatcher({
    ...dispatchInput
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
