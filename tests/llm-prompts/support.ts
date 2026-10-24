import { buildAnswerMessages } from '../../src/llm/openai-compatible-client/answer.js';
import { buildIntentPrompt } from '../../src/llm/prompts.js';
export function createPromptReplyContext(commandText: string) {
  return {
    triggerMessage: {
      chatId: 1,
      messageId: 3,
      userId: 1,
      senderDisplayName: 'Tom',
      text: commandText,
      createdAt: '2026-04-03T12:00:00.000Z',
      isBot: false,
      replyToMessageId: null
    },
    replyAnchorMessage: null,
    priorContextMessages: []
  };
}

export function promptFor(
  input: Omit<Parameters<typeof buildIntentPrompt>[0], 'intent'> & {
    intent: 'answer' | 'read' | 'translate';
  }
): string {
  if (input.intent === 'answer')
    return buildAnswerMessages(input)
      .map((message) => message.content)
      .join('\n\n');

  return buildIntentPrompt({ ...input, intent: input.intent });
}
