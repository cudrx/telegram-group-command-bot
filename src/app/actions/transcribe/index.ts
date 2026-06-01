import type { ActionContext, ChatAction } from '../types.js';
import { runTranscribeVideoJob } from './transcribe-command.js';

export const transcribeAction: ChatAction = {
  intent: 'transcribe',
  commands: ['transcribe'],
  modes: ['chat'],
  async handle(ctx: ActionContext): Promise<void> {
    await runTranscribeVideoJob({
      deps: ctx.deps,
      request: ctx.request,
      logger: ctx.logger
    });
  }
};
