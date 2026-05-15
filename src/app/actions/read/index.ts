import type { ActionContext, ChatAction } from '../types.js';
import { runReadTtsJob } from './read-command.js';

export const readAction: ChatAction = {
  intent: 'read',
  commands: ['read'],
  modes: ['chat'],
  async handle(ctx: ActionContext): Promise<void> {
    await runReadTtsJob({
      deps: ctx.deps,
      request: ctx.request,
      logger: ctx.logger
    });
  }
};
