import type {
  AssistantIntent,
  ReplyContext,
  StoredMessage
} from '../domain/models.js';
import type { LookupContext, LookupSource } from '../lookup/types.js';
import { loadPrompt } from './prompt-files.js';

export type PromptMessage = Pick<
  StoredMessage,
  'messageId' | 'userId' | 'senderDisplayName' | 'text' | 'createdAt' | 'isBot'
>;

export type DescribeMediaContext = {
  sourceCaption: string | null;
  visibleText: string[];
  visualDetails: unknown;
  audioTranscript: {
    transcript: string;
    language: string | null;
    sourceDurationSeconds: number | null;
  } | null;
};

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

export function buildIntentPrompt(input: {
  assistantInstructions: string;
  targetDisplayName: string;
  intent: AssistantIntent;
  replyContext: ReplyContext;
  lookupContext?: LookupContext | null;
  mediaContext?: DescribeMediaContext | null;
}): string {
  const dataSections = getIntentDataSections(input);
  const lookupSections =
    input.intent === 'summarize' || !input.lookupContext
      ? ''
      : [
          '',
          'EXTERNAL_LOOKUP_CONTEXT:',
          formatLookupContext(input.lookupContext)
        ].join('\n');

  return renderPromptTemplate(loadPrompt('replyShell'), {
    assistantInstructions: input.assistantInstructions,
    globalPrompt: loadPrompt('global'),
    targetDisplayName: sanitizePromptText(input.targetDisplayName),
    intent: input.intent,
    intentPrompt: getIntentPrompt(input.intent),
    dataSections,
    lookupSections
  });
}

function getIntentPrompt(intent: AssistantIntent): string {
  switch (intent) {
    case 'explain':
      return loadPrompt('explain');
    case 'summarize':
      return loadPrompt('summarize');
    case 'decide':
      return loadPrompt('decide');
    case 'describe':
      return loadPrompt('describe');
  }
}

function getIntentDataSections(input: {
  intent: AssistantIntent;
  replyContext: ReplyContext;
  mediaContext?: DescribeMediaContext | null;
}): string {
  if (input.intent === 'explain') {
    return renderPromptTemplate(loadPrompt('replyDataExplain'), {
      targetMessage: formatSingleMessage(input.replyContext.replyAnchorMessage),
      nearbyChatContext: formatReplyContextMessages(
        input.replyContext.priorContextMessages
      ),
      currentCommandMessage: formatCommandMessage(
        input.replyContext.triggerMessage
      )
    });
  }

  if (input.intent === 'describe') {
    return renderPromptTemplate(loadPrompt('replyDataDescribe'), {
      currentCommandMessage: formatCommandMessage(
        input.replyContext.triggerMessage
      ),
      caption: sanitizePromptText(
        input.mediaContext?.sourceCaption ?? 'No caption.'
      ),
      visibleText: formatJsonForPrompt(input.mediaContext?.visibleText ?? []),
      visualDetails: formatJsonForPrompt(
        input.mediaContext?.visualDetails ?? null
      ),
      audioTranscript: formatJsonForPrompt(
        input.mediaContext?.audioTranscript ?? null
      ),
      chatContext: formatReplyContextMessages(
        input.replyContext.priorContextMessages
      )
    });
  }

  return renderPromptTemplate(loadPrompt('replyDataGeneric'), {
    currentCommandMessage: formatCommandMessage(
      input.replyContext.triggerMessage
    ),
    chatContext: formatReplyContextMessages(
      input.replyContext.priorContextMessages
    )
  });
}

function formatSingleMessage(message: PromptMessage | null): string {
  if (!message) {
    return 'No message available.';
  }

  return formatConversationForLlm([message]);
}

function formatCommandMessage(message: PromptMessage | null): string {
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

function formatReplyContextMessages(messages: PromptMessage[]): string {
  return renderPromptTemplate(loadPrompt('replyChatTranscript'), {
    transcript: formatConversationForLlm(messages)
  });
}

function formatLookupContext(context: LookupContext): string {
  return [
    loadPrompt('lookupContext'),
    `status=${sanitizePromptText(context.status)}`,
    `provider=${context.provider ? sanitizePromptText(context.provider) : 'null'}`,
    `purpose=${sanitizePromptText(context.decision.purpose)}`,
    `confidence=${sanitizePromptText(context.decision.confidence)}`,
    `reason="${sanitizePromptText(context.decision.reason)}"`,
    `query=${context.query ? `"${sanitizePromptText(context.query)}"` : 'null'}`,
    `responseTimeMs=${context.responseTimeMs ?? 'null'}`,
    `usageCredits=${context.usageCredits ?? 'null'}`,
    `error=${context.errorMessage ? `"${sanitizePromptText(context.errorMessage)}"` : 'null'}`,
    'BEGIN LOOKUP SOURCES',
    ...context.sources.map((source, index) =>
      formatLookupSource(source, index)
    ),
    'END LOOKUP SOURCES'
  ].join('\n');
}

function formatLookupSource(source: LookupSource, index: number): string {
  return [
    `source#${index + 1}`,
    `title="${sanitizePromptText(source.title)}"`,
    `url="${sanitizePromptText(source.url)}"`,
    `score=${source.score ?? 'null'}`,
    `content="${sanitizePromptText(source.content)}"`
  ].join(' ');
}

function formatJsonForPrompt(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .replace(/```/g, '[triple-backticks]')
    .replace(
      /\b(BEGIN|END) (CHAT TRANSCRIPT|LOOKUP SOURCES)\b/gi,
      (match) => `[quoted-${match.toUpperCase()}]`
    )
    .replace(
      /\b(system|assistant|developer|user)\s*:/gi,
      (_match, role: string) => `[quoted-${role.toLowerCase()}-marker]`
    );
}

function sanitizePromptText(value: string): string {
  return value
    .replace(/```/g, '[triple-backticks]')
    .replace(/\r?\n+/g, ' \\n ')
    .replace(
      /\b(BEGIN|END) (CHAT TRANSCRIPT|LOOKUP SOURCES)\b/gi,
      (match) => `[quoted-${match.toUpperCase()}]`
    )
    .replace(
      /\b(system|assistant|developer|user)\s*:/gi,
      (_match, role: string) => `[quoted-${role.toLowerCase()}-marker]`
    )
    .replace(/"/g, '\\"')
    .trim();
}

function extractCommandText(text: string): string {
  return text.trim().split(/\s+/, 1)[0] ?? '';
}

function renderPromptTemplate(
  template: string,
  values: Record<string, string>
): string {
  return Object.entries(values)
    .reduce(
      (rendered, [key, value]) =>
        rendered.replaceAll(`{{${key}}}`, () => value),
      template
    )
    .trim();
}
