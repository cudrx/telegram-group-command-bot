import { memeActionConfig } from '../../../config/runtime/index.js';
import { runMemeJob } from '../../chat-orchestrator/meme-job/listing.js';
import type { ActionContext, ChatAction } from '../types.js';

export const memeAction: ChatAction = {
  intent: 'meme',
  commands: ['meme'],
  modes: ['chat'],
  async handle(ctx: ActionContext): Promise<void> {
    const policy = ctx.deps.env.telegramChatPolicies.find(
      (candidate) => candidate.chatId === ctx.request.chatId
    );

    if (!policy?.reddit_sources.meme) {
      throw new Error(
        `Missing reddit_sources.meme for chat ${ctx.request.chatId}.`
      );
    }

    await runMemeJob({
      deps: ctx.deps,
      request: ctx.request,
      mediaSupport: ctx.mediaSupport,
      logger: ctx.logger,
      config: {
        ...memeActionConfig,
        subreddits: policy.reddit_sources.meme
      }
    });
  }
};
