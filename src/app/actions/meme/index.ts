import { runMemeJob } from '../../chat-orchestrator/meme-job/listing.js';
import type { ActionContext, ChatAction } from '../types.js';

export const memeAction: ChatAction = {
  intent: 'meme',
  commands: ['meme'],
  modes: ['chat'],
  async handle(ctx: ActionContext): Promise<void> {
    await runMemeJob({
      deps: ctx.deps,
      request: ctx.request,
      mediaSupport: ctx.mediaSupport,
      logger: ctx.logger
    });
  }
};
