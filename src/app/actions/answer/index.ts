import { createLlmReplyAction } from '../shared/llm-reply.js';

export const answerAction = createLlmReplyAction({
  intent: 'answer',
  commands: ['answer']
});
