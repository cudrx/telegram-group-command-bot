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
