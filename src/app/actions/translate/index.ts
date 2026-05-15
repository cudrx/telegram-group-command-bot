import { createLlmReplyAction } from '../shared/llm-reply.js';

export const translateAction = createLlmReplyAction({
  intent: 'translate',
  commands: ['translate']
});
