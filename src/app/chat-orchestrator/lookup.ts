import type { AssistantIntent, ReplyContext } from '../../domain/models.js';
import type { LookupPlanResult } from '../../llm/openai-compatible-client/index.js';
import type { AppLogger } from '../../logging/logger.js';
import { serializeError } from '../../logging/logger.js';
import type { LookupContext, LookupIntent } from '../../lookup/types.js';
import {
  createFailedLookupDecision,
  createLookupContext,
  isTimeoutError
} from './helpers.js';
import type { ChatOrchestratorDeps } from './types.js';

export async function buildLookupContext(
  deps: Pick<ChatOrchestratorDeps, 'env' | 'lookupProvider' | 'qwen'>,
  input: {
    intent: AssistantIntent;
    replyContext: ReplyContext;
    logger: AppLogger;
  }
): Promise<LookupContext | null> {
  if (input.intent === 'summarize' || input.intent === 'read') {
    return null;
  }

  const lookupIntent: LookupIntent = input.intent;

  if (!deps.lookupProvider) {
    return null;
  }

  let plan: LookupPlanResult;

  try {
    plan = await deps.qwen.planLookup({
      intent: lookupIntent,
      replyContext: input.replyContext
    });
  } catch (error) {
    input.logger.warn('lookup_planner_failed', {
      intent: input.intent,
      ...serializeError(error)
    });

    return createLookupContext({
      status: 'failed',
      intent: lookupIntent,
      decision: createFailedLookupDecision('Lookup planner failed.'),
      errorMessage: error instanceof Error ? error.message : String(error)
    });
  }

  const decision = plan.decision;

  if (plan.status === 'failed') {
    return createLookupContext({
      status: 'failed',
      intent: lookupIntent,
      decision,
      errorMessage: decision.reason
    });
  }

  input.logger.debug('lookup_planner_completed', {
    intent: input.intent,
    shouldLookup: decision.shouldLookup,
    purpose: decision.purpose,
    confidence: decision.confidence,
    queryCount: decision.queries.length,
    plannerModel: plan.model,
    plannerLatencyMs: plan.latencyMs
  });

  if (!decision.shouldLookup) {
    return createLookupContext({
      status: 'skipped',
      intent: lookupIntent,
      decision
    });
  }

  const query = decision.queries[0] ?? null;

  if (!query) {
    return createLookupContext({
      status: 'skipped',
      intent: lookupIntent,
      decision
    });
  }

  try {
    const result = await deps.lookupProvider.search({
      query,
      maxResults: deps.env.lookupMaxResults,
      timeoutMs: deps.env.lookupTimeoutMs
    });

    return createLookupContext({
      status: result.sources.length > 0 ? 'used' : 'weak',
      provider: result.provider,
      intent: lookupIntent,
      decision,
      query: result.query,
      sources: result.sources,
      responseTimeMs: result.responseTimeMs,
      usageCredits: result.usageCredits
    });
  } catch (error) {
    input.logger.warn('lookup_provider_failed', {
      intent: input.intent,
      query,
      ...serializeError(error)
    });

    return createLookupContext({
      status: isTimeoutError(error) ? 'timed_out' : 'failed',
      intent: lookupIntent,
      decision,
      query,
      errorMessage: error instanceof Error ? error.message : String(error)
    });
  }
}
