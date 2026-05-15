import { createLlmReplyAction } from '../shared/llm-reply.js';

export const decideAction = createLlmReplyAction({
  intent: 'decide',
  commands: ['decide']
});
