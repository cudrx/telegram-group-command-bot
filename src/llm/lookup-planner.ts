import type { ReplyContext } from '../domain/models.js';
import type {
  LookupConfidence,
  LookupDecision,
  LookupIntent,
  LookupPurpose
} from '../lookup/types.js';
import { loadPrompt } from './prompt-files.js';
import { formatConversationForLlm } from './prompts.js';

export function buildLookupPlannerPrompt(input: {
  intent: LookupIntent;
  replyContext: ReplyContext;
}): string {
  const targetSection =
    input.intent === 'answer'
      ? [
          'TARGET_MESSAGE_TO_ANSWER:',
          input.replyContext.replyAnchorMessage
            ? formatConversationForLlm([input.replyContext.replyAnchorMessage])
            : 'No target message available.'
        ]
      : [
          'CHAT_CONTEXT_DATA:',
          formatConversationForLlm(input.replyContext.priorContextMessages)
        ];

  return [
    loadPrompt('lookup'),
    '',
    `Current command intent: ${input.intent}`,
    '',
    ...targetSection,
    '',
    'CURRENT_COMMAND_MESSAGE:',
    input.replyContext.triggerMessage
      ? formatConversationForLlm([
          {
            ...input.replyContext.triggerMessage,
            text: stripCommandArguments(input.replyContext.triggerMessage.text)
          }
        ])
      : 'No command message available.'
  ].join('\n');
}

function stripCommandArguments(text: string): string {
  return text.trim().split(/\s+/, 1)[0] ?? '';
}

export function parseLookupDecisionResult(
  raw: string,
  maxQueries: number
): {
  decision: LookupDecision;
  status: 'ok' | 'failed';
} {
  const invalidJsonDecision = safeSkipDecision(
    'Lookup planner returned invalid JSON.'
  );
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return { decision: invalidJsonDecision, status: 'failed' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { decision: invalidJsonDecision, status: 'failed' };
  }

  const candidate = parsed as {
    shouldLookup?: unknown;
    purpose?: unknown;
    reason?: unknown;
    queries?: unknown;
    confidence?: unknown;
  };

  if (typeof candidate.shouldLookup !== 'boolean') {
    return {
      decision: safeSkipDecision('Lookup planner returned invalid decision.'),
      status: 'failed'
    };
  }

  const purpose = isLookupPurpose(candidate.purpose) ? candidate.purpose : null;
  const confidence = isLookupConfidence(candidate.confidence)
    ? candidate.confidence
    : null;
  const reason =
    typeof candidate.reason === 'string' ? candidate.reason.trim() : '';
  const queries = Array.isArray(candidate.queries)
    ? candidate.queries
        .filter((query): query is string => typeof query === 'string')
        .map((query) => query.trim())
        .filter(Boolean)
        .slice(0, Math.max(0, maxQueries))
    : [];

  if (!purpose || !confidence) {
    return {
      decision: safeSkipDecision('Lookup planner returned invalid decision.'),
      status: 'failed'
    };
  }

  if (candidate.shouldLookup && queries.length === 0) {
    return {
      decision: safeSkipDecision(
        'Lookup planner requested lookup without a query.'
      ),
      status: 'failed'
    };
  }

  if (!candidate.shouldLookup) {
    return {
      decision: {
        shouldLookup: false,
        purpose: 'none',
        reason: reason || 'Lookup planner skipped lookup.',
        queries: [],
        confidence
      },
      status: 'ok'
    };
  }

  return {
    decision: {
      shouldLookup: true,
      purpose,
      reason: reason || 'Lookup planner requested lookup.',
      queries,
      confidence
    },
    status: 'ok'
  };
}

function safeSkipDecision(reason: string): LookupDecision {
  return {
    shouldLookup: false,
    purpose: 'none',
    reason,
    queries: [],
    confidence: 'low'
  };
}

function isLookupPurpose(value: unknown): value is LookupPurpose {
  return (
    value === 'none' ||
    value === 'entity_grounding' ||
    value === 'fact_check' ||
    value === 'freshness' ||
    value === 'link_extraction'
  );
}

function isLookupConfidence(value: unknown): value is LookupConfidence {
  return value === 'high' || value === 'medium' || value === 'low';
}
