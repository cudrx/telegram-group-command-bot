import { runReplyJob } from '../../chat-orchestrator/reply-job.js';
import type { ChatAction } from '../types.js';

export const translateAction: ChatAction = {
  intent: 'translate',
  commands: ['translate'],
  modes: ['chat'],
  async handle({ deps, mediaSupport, request, logger }) {
    await runReplyJob({
      deps,
      mediaSupport,
      request: { ...request, intent: 'translate' },
      logger
    });
  }
};
