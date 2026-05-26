import { memeActionConfig } from '../../../config/runtime/index.js';
import { formatMemeCaption } from '../../actions/meme/caption.js';
import { dispatchMemeMedia } from '../../actions/meme/telegram-dispatcher.js';
import type {
  DownloadedMemeMedia,
  MemePostCandidate,
  ResolvedMemeMedia
} from '../../actions/meme/types.js';
import { toMemeMediaKind } from '../../actions/meme/types.js';
import { runWithChatAction } from '../helpers/reply.js';
import type { ChatOrchestratorMediaSupport } from '../media/index.js';
import type { ChatOrchestratorDeps, ReplyRequest } from '../types.js';
import { downloadResolvedMedia, getMemeChatAction } from './download.js';

export type MemeJobInput = {
  deps: ChatOrchestratorDeps;
  request: ReplyRequest;
  mediaSupport?: ChatOrchestratorMediaSupport;
  logger: ChatOrchestratorDeps['logger'];
};

export async function sendCandidate(
  input: MemeJobInput,
  candidate: MemePostCandidate,
  options: { reply?: boolean } = {}
): Promise<void> {
  await runWithChatAction(
    input.deps,
    input.request.chatId,
    getMemeChatAction(candidate.media),
    async () => {
      const downloaded = await downloadResolvedMedia(
        input.deps,
        candidate.media
      );

      await sendDownloadedCandidate(input, candidate, downloaded, options);
    }
  );
}

export async function sendDownloadedCandidate(
  input: MemeJobInput,
  candidate: MemePostCandidate,
  downloaded: DownloadedMemeMedia,
  options: { reply?: boolean } = {}
): Promise<void> {
  try {
    const reply = options.reply ?? true;
    const replyToMessageId = reply ? input.request.triggerMessageId : null;
    const caption = formatMemeCaption({
      title: candidate.title,
      subreddit: candidate.subreddit,
      upvotes: candidate.upvotes,
      permalink: candidate.permalink,
      maxLength: memeActionConfig.caption.maxLength
    });

    const sent = await dispatchMemeMedia({
      memeDispatcher: input.deps.memeDispatcher,
      chatId: input.request.chatId,
      replyToMessageId,
      reply,
      caption,
      ...(candidate.media.hasSpoiler ? { hasSpoiler: true } : {}),
      media: downloaded
    });
    input.deps.db.saveBotMessage({
      chatId: input.request.chatId,
      chatType: input.request.chatType,
      chatTitle: input.request.chatTitle,
      messageId: sent.messageId,
      text: caption,
      createdAt: sent.createdAt,
      userId: input.deps.bot.userId,
      username: input.deps.bot.username,
      displayName: input.deps.bot.displayName,
      replyToMessageId,
      outputMode: 'text',
      mediaSnapshot: sent.mediaSnapshot ?? null
    });

    const storedMessage = input.deps.db.getMessageByTelegramMessageId(
      input.request.chatId,
      sent.messageId
    );

    if (storedMessage) {
      input.mediaSupport?.startAutoReadForIncomingMessage(
        storedMessage,
        input.logger
      );
    }

    input.deps.db.saveMemePost({
      chatId: input.request.chatId,
      redditPostId: candidate.redditPostId,
      subreddit: candidate.subreddit,
      telegramMessageId: sent.messageId,
      title: candidate.title,
      permalink: candidate.permalink,
      mediaKind: toMemeMediaKind(candidate.media),
      mediaUrl: getPrimaryMediaUrl(candidate.media),
      upvotes: candidate.upvotes,
      sentAt: sent.createdAt
    });
  } finally {
    await downloaded.cleanup();
  }
}

export async function sendMemeFallback(
  input: Pick<MemeJobInput, 'deps' | 'request'>
): Promise<void> {
  const sent = await input.deps.replyDispatcher({
    chatId: input.request.chatId,
    replyToMessageId: input.request.triggerMessageId,
    text: memeActionConfig.fallbackText
  });

  input.deps.db.saveBotMessage({
    chatId: input.request.chatId,
    chatType: input.request.chatType,
    chatTitle: input.request.chatTitle,
    messageId: sent.messageId,
    text: memeActionConfig.fallbackText,
    createdAt: sent.createdAt,
    userId: input.deps.bot.userId,
    username: input.deps.bot.username,
    displayName: input.deps.bot.displayName,
    replyToMessageId: input.request.triggerMessageId,
    outputMode: 'text'
  });
}

function getPrimaryMediaUrl(media: ResolvedMemeMedia): string | null {
  if (media.kind === 'gallery') return null;

  return media.mediaUrl;
}
