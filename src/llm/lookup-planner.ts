import type { AssistantIntent, ReplyContext } from '../domain/models.js';
import type {
  LookupConfidence,
  LookupDecision,
  LookupPurpose
} from '../lookup/types.js';
import { formatConversationForLlm } from './prompts.js';

export function buildLookupPlannerPrompt(input: {
  intent: Exclude<AssistantIntent, 'summarize'>;
  replyContext: ReplyContext;
}): string {
  const targetSection =
    input.intent === 'explain'
      ? [
          'TARGET_MESSAGE_TO_EXPLAIN:',
          input.replyContext.replyAnchorMessage
            ? formatConversationForLlm([input.replyContext.replyAnchorMessage])
            : 'No target message available.'
        ]
      : [
          'CHAT_CONTEXT_DATA:',
          formatConversationForLlm(input.replyContext.priorContextMessages)
        ];

  return [
    'You are a Telegram lookup planner.',
    '',
    'Always decide whether external lookup is useful for this command.',
    'Lookup allowed only for /explain and /decide.',
    'Choose lookup whenever external grounding could improve correctness.',
    'When uncertain, choose lookup.',
    'Use entity_grounding for named entities/artists/products/games/laws/memes/tools/places/events/unfamiliar references.',
    'Use fact_check when a dispute depends on a checkable external claim.',
    'Use freshness when current or recent information matters.',
    'Use link_extraction when a URL or linked source must be understood.',
    'Skip lookup only when relevant meaning is fully contained in chat.',
    'Subjective disputes can still need lookup if misunderstanding subject changes answer.',
    'Return only minified JSON with shape {"shouldLookup":boolean,"purpose":"none|entity_grounding|fact_check|freshness|link_extraction","reason":"short reason","queries":["one concise search query"],"confidence":"high|medium|low"}',
    '',
    `Current command intent: ${input.intent}`,
    '',
    ...targetSection,
    '',
    'CURRENT_COMMAND_MESSAGE:',
    input.replyContext.triggerMessage
      ? formatConversationForLlm([input.replyContext.triggerMessage])
      : 'No command message available.'
  ].join('\n');
}

export function parseLookupDecision(
  raw: string,
  maxQueries: number
): LookupDecision {
  return parseLookupDecisionResult(raw, maxQueries).decision;
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
