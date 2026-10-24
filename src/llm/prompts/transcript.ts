import { answerActionConfig } from '../../config/runtime/index.js';
import type { StoredMessage } from '../../domain/models.js';
import { formatMoscowCurrentDateTime } from '../current-datetime.js';
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

      return `[${formatMoscowCurrentDateTime(message.createdAt)}] messageId=${message.messageId} replyToMessageId=${message.replyToMessageId ?? 'null'} actor=${actor} content="${sanitizePromptText(message.text)}"`;
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

export function formatReplyContextMetadata(input: {
  messages: PromptMessage[];
  metadata:
    | {
        truncated: boolean;
        includedMessageCount: number;
      }
    | undefined;
}): string {
  return [
    `contextTruncated=${input.metadata?.truncated ?? false}`,
    `includedMessageCount=${input.metadata?.includedMessageCount ?? input.messages.length}`
  ].join('\n');
}

function extractCommandText(text: string): string {
  return text.trim().split(/\s+/, 1)[0] ?? '';
}

export function boundMessage(message: StoredMessage): StoredMessage {
  const max = answerActionConfig.context.maxMessageChars;
  if (message.text.length <= max) return message;

  return {
    ...message,
    text: `${message.text.slice(0, max)} [message text truncated]`
  };
}
