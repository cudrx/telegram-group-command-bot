export function createReplyResult(text: string) {
  return {
    text,
    model: 'reply-model',
    source: 'llm' as const,
    latencyMs: 10,
    attemptCount: 1,
    promptTokensEstimate: 20
  };
}

export function createLookupPlanResult(decision: {
  shouldLookup: boolean;
  purpose:
    | 'none'
    | 'entity_grounding'
    | 'fact_check'
    | 'freshness'
    | 'link_extraction';
  reason: string;
  queries: string[];
  confidence: 'high' | 'medium' | 'low';
}) {
  return {
    status: 'ok' as const,
    decision,
    model: 'planner-model',
    latencyMs: 5,
    attemptCount: 1,
    promptTokensEstimate: 30
  };
}
