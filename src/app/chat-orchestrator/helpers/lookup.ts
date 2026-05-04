import type {
  LookupContext,
  LookupDecision,
  LookupIntent
} from '../../../lookup/types.js';

export function createLookupContext(input: {
  status: LookupContext['status'];
  provider?: LookupContext['provider'];
  intent: LookupIntent;
  decision: LookupDecision;
  query?: string | null;
  sources?: LookupContext['sources'];
  responseTimeMs?: number | null;
  usageCredits?: number | null;
  errorMessage?: string | null;
}): LookupContext {
  return {
    status: input.status,
    provider: input.provider ?? null,
    intent: input.intent,
    decision: input.decision,
    query: input.query ?? null,
    sources: input.sources ?? [],
    responseTimeMs: input.responseTimeMs ?? null,
    usageCredits: input.usageCredits ?? null,
    errorMessage: input.errorMessage ?? null
  };
}

export function createFailedLookupDecision(reason: string): LookupDecision {
  return {
    shouldLookup: false,
    purpose: 'none',
    reason,
    queries: [],
    confidence: 'low'
  };
}

export function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}
