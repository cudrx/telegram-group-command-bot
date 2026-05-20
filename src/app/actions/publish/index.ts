import type { StoredMessage } from '../../../domain/models.js';
import type { ActionContext, ChatAction } from '../types.js';

const missingTargetText =
  'Не нашел сообщение для /publish. Сделай reply или отправь команду после сообщения.';
const copyFailedText = 'Telegram не дал скопировать это сообщение.';

export const publishAction: ChatAction = {
  intent: 'publish',
  commands: ['publish'],
  modes: ['private_admin'],
  async handle(ctx: ActionContext): Promise<void> {
    const target = resolvePublishTarget(ctx);

    if (!target) {
      await ctx.deps.replyDispatcher({
        chatId: ctx.request.chatId,
        replyToMessageId: ctx.request.triggerMessageId,
        text: missingTargetText
      });
      return;
    }

    try {
      const albumMessageIds = getAlbumMessageIds(ctx, target);

      if (albumMessageIds.length > 1) {
        await ctx.deps.copyMessagesDispatcher({
          targetChatId: ctx.deps.env.telegramChatId,
          sourceChatId: ctx.request.chatId,
          messageIds: albumMessageIds
        });
        return;
      }

      await ctx.deps.copyMessageDispatcher({
        targetChatId: ctx.deps.env.telegramChatId,
        sourceChatId: ctx.request.chatId,
        messageId: target.messageId
      });
    } catch (error) {
      ctx.logger.warn('publish_copy_failed', {
        targetMessageId: target.messageId,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      await ctx.deps.replyDispatcher({
        chatId: ctx.request.chatId,
        replyToMessageId: ctx.request.triggerMessageId,
        text: copyFailedText
      });
    }
  }
};

function resolvePublishTarget(ctx: ActionContext): StoredMessage | null {
  const replyTarget = ctx.request.replyToMessageSnapshot
    ? (ctx.deps.db.getMessageByTelegramMessageId(
        ctx.request.chatId,
        ctx.request.replyToMessageSnapshot.messageId
      ) ?? ctx.request.replyToMessageSnapshot)
    : null;

  if (replyTarget) return replyTarget;

  return (
    ctx.deps.db.getMessagesBefore(
      ctx.request.chatId,
      ctx.request.triggerMessageId,
      1
    )[0] ?? null
  );
}

function getAlbumMessageIds(
  ctx: ActionContext,
  target: StoredMessage
): number[] {
  if (!target.mediaGroupId) {
    return [];
  }

  const albumMessages = ctx.deps.db.getMessagesByMediaGroupId({
    chatId: ctx.request.chatId,
    mediaGroupId: target.mediaGroupId
  });

  const hasTarget = albumMessages.some(
    (message) => message.messageId === target.messageId
  );

  if (!hasTarget) {
    return [];
  }

  return albumMessages.map((message) => message.messageId);
}
