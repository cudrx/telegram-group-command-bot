import type { ReplyContext } from '../../src/domain/models.js';

export type HistoryVariant = 'full' | 'omitted' | 'ancestors';
export type ExperimentVariant = 'A' | 'B' | 'C' | 'D';
export type ExperimentMessage = { role: 'system' | 'user'; content: string };

export function parseExperimentVariants(
  value: string | undefined,
  hasBaseline: boolean
): ExperimentVariant[] {
  const allowed: ExperimentVariant[] = hasBaseline
    ? ['A', 'D']
    : ['A', 'B', 'C'];
  const selected = (value ?? allowed.join(',')).split(
    ','
  ) as ExperimentVariant[];
  if (
    new Set(selected).size !== selected.length ||
    selected.some((variant) => !allowed.includes(variant))
  )
    throw new Error(`variants must be a unique subset of ${allowed.join(',')}`);

  return selected;
}

export function filterVisibleContext(
  context: ReplyContext,
  messageIds: number[]
): ReplyContext {
  const visible = new Set(messageIds);
  let anchor = context.replyAnchorMessage;
  if (anchor && !visible.has(anchor.messageId)) anchor = null;

  return {
    ...context,
    replyAnchorMessage: anchor,
    priorContextMessages: context.priorContextMessages.filter((message) =>
      visible.has(message.messageId)
    )
  };
}

export function plannerMessagesForAttempt(
  prepared: ExperimentMessage[],
  attempt: ExperimentMessage[]
): ExperimentMessage[] {
  const corrections = attempt.slice(2);
  return [...prepared, ...corrections];
}

export function compareProductionPrompts(
  baseline: ExperimentMessage[],
  candidate: ExperimentMessage[],
  variant: 'A' | 'D'
): ExperimentMessage[] {
  const data = (messages: ExperimentMessage[]) =>
    messages.filter((message) => message.role !== 'system');
  if (JSON.stringify(data(baseline)) !== JSON.stringify(data(candidate)))
    throw new Error('Production comparison changed conversation data');

  return (variant === 'A' ? baseline : candidate).map((message) => ({
    ...message
  }));
}

export function getReplyAncestorIds(context: ReplyContext): Set<number> {
  const rows = [context.replyAnchorMessage, ...context.priorContextMessages];
  const byId = new Map(
    rows.filter((row) => row !== null).map((row) => [row.messageId, row])
  );
  const ids = new Set<number>();
  let id = context.triggerMessage?.replyToMessageId;
  while (id && !ids.has(id)) {
    const row = byId.get(id);
    if (!row) break;

    ids.add(id);
    id = row.replyToMessageId;
  }

  return ids;
}

export function transformExperimentMessages(
  messages: ExperimentMessage[],
  variant: HistoryVariant,
  ancestorIds: Set<number>
): ExperimentMessage[] {
  if (variant === 'full') return messages.map((message) => ({ ...message }));

  return messages.map((message) => {
    if (message.role !== 'user') return { ...message };

    let target = false;
    let removed = false;
    const lines = message.content.split('\n').flatMap((line) => {
      if (line === 'TARGET_MESSAGE_TO_ANSWER:') target = true;
      else if (/^[A-Z_]+:$/.test(line)) target = false;

      const row = readTranscriptRow(line);
      if (!row?.isBot || (variant === 'ancestors' && ancestorIds.has(row.id)))
        return [line];

      removed = true;

      return target ? ['No message available.'] : [];
    });
    const content = lines.join('\n');
    const transcript =
      content
        .split('BEGIN CHAT TRANSCRIPT\n')[1]
        ?.split('\nEND CHAT TRANSCRIPT')[0] ?? '';
    const count = transcript
      .split('\n')
      .filter((line) => readTranscriptRow(line)).length;

    return {
      ...message,
      content: content
        .replace(/includedMessageCount=\d+/, `includedMessageCount=${count}`)
        .replace(
          /contextTruncated=false/,
          removed ? 'contextTruncated=true' : 'contextTruncated=false'
        )
    };
  });
}

export function readTranscriptRow(
  line: string
): { id: number; isBot: boolean } | null {
  const row =
    /^\[[^\]]+\] messageId=(\d+) replyToMessageId=(?:null|\d+) actor=(bot |user#)/.exec(
      line
    );

  return row ? { id: Number(row[1]), isBot: row[2] === 'bot ' } : null;
}
