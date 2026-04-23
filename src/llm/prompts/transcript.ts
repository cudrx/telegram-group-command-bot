import { loadPrompt } from '../prompt-files.js';
import { renderPromptTemplate } from './render.js';
import { sanitizePromptText } from './sanitize.js';
import type { PromptMessage } from './types.js';

export function formatConversationForLlm(messages: PromptMessage[]): string {
  return messages
    .map((message) => {
      const actor = message.isBot
        ? `bot ${sanitizePromptText(message.senderDisplayName)}`
        : `user#${message.userId ?? 'unknown'} ${sanitizePromptText(message.senderDisplayName)}`;

      return `[${message.createdAt}] actor=${actor} content="${sanitizePromptText(message.text)}"`;
    })
    .join('\n');
}

export function formatSingleMessage(message: PromptMessage | null): string {
  if (!message) {
    return 'No message available.';
  }

  return formatConversationForLlm([message]);
}

export function formatCommandMessage(message: PromptMessage | null): string {
  if (!message) {
    return 'No message available.';
  }

  return formatConversationForLlm([
    {
      ...message,
      text: extractCommandText(message.text)
    }
  ]);
}

export function formatReplyContextMessages(messages: PromptMessage[]): string {
  return renderPromptTemplate(loadPrompt('systemTranscript'), {
    transcript: formatConversationForLlm(messages)
  });
}

function extractCommandText(text: string): string {
  return text.trim().split(/\s+/, 1)[0] ?? '';
}
