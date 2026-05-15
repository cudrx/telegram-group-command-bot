import { runReplyJob } from '../../chat-orchestrator/reply-job.js';
import type { ReplyJobRequest } from '../../chat-orchestrator/types.js';
import type { ActionContext, ChatAction } from '../types.js';

export function createLlmReplyAction(input: {
  intent: Exclude<ReplyJobRequest['intent'], 'read'>;
  commands: string[];
}): ChatAction {
  return {
    intent: input.intent,
    commands: input.commands,
    modes: ['chat'],
    async handle(ctx: ActionContext): Promise<void> {
      await runReplyJob({
        deps: ctx.deps,
        mediaSupport: ctx.mediaSupport,
        request: {
          ...ctx.request,
          intent: input.intent
        },
        logger: ctx.logger
      });
    }
  };
}
