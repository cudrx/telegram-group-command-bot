import { createLlmReplyAction } from '../shared/llm-reply.js';

export const summarizeAction = createLlmReplyAction({
  intent: 'summarize',
  commands: ['summarize']
});
