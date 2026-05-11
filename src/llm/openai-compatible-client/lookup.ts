import {
  llmProviderConfig,
  lookupProviderConfig
} from '../../config/runtime/index.js';
import type { LookupDecision } from '../../lookup/types.js';
import {
  buildLookupPlannerPrompt,
  parseLookupDecisionResult
} from '../lookup-planner.js';
import { estimateTokens, logLlmText, toSingleLinePreview } from './logging.js';
import { withRetry } from './retry.js';
import type {
  ChatCompletionsCreate,
  LlmClientConfig,
  LlmClientOptions,
  LookupPlanResult,
  PlanLookupInput
} from './types.js';

export async function planLookup(params: {
  config: LlmClientConfig;
  createCompletion: ChatCompletionsCreate;
  options: LlmClientOptions;
  input: PlanLookupInput;
}): Promise<LookupPlanResult> {
  const { config, createCompletion, options, input } = params;
  const prompt = buildLookupPlannerPrompt(input);
  const promptTokensEstimate = estimateTokens(prompt);
  const startedAt = Date.now();
  const plannerModel = config.plannerModel ?? config.replyModel;
  const lookupMaxQueries =
    config.lookupMaxQueries ?? lookupProviderConfig.defaults.maxQueries;

  logLlmText(options, 'llm.lookup_planner.request', {
    kind: 'lookup_planner',
    model: plannerModel,
    temperature: llmProviderConfig.lookupPlanner.temperature,
    promptChars: prompt.length,
    promptTokensEstimate
  });

  const completion = await withRetry(
    () =>
      createCompletion({
        model: plannerModel,
        temperature: llmProviderConfig.lookupPlanner.temperature,
        max_tokens: llmProviderConfig.lookupPlanner.maxTokens,
        thinking: { type: 'disabled' },
        messages: [
          {
            role: 'system',
            content:
              'You plan web lookup for a Telegram assistant. Return only valid JSON.'
          },
          {
            role: 'user',
            content: prompt
          }
        ]
      } as never),
    config
  );

  const raw = completion.value.choices[0]?.message.content?.trim() ?? '';

  if (!raw) {
    const decision: LookupDecision = {
      shouldLookup: false,
      purpose: 'none',
      reason: 'Lookup planner returned empty content.',
      queries: [],
      confidence: 'low'
    };

    logLlmText(options, 'llm.lookup_planner.response', {
      kind: 'lookup_planner',
      model: plannerModel,
      latencyMs: Date.now() - startedAt,
      attemptCount: completion.attemptCount,
      promptTokensEstimate,
      responseChars: 0,
      responsePreview: ''
    });

    return {
      status: 'failed',
      decision,
      model: plannerModel,
      latencyMs: Date.now() - startedAt,
      attemptCount: completion.attemptCount,
      promptTokensEstimate
    };
  }

  const parsedDecision = parseLookupDecisionResult(raw, lookupMaxQueries);

  logLlmText(options, 'llm.lookup_planner.response', {
    kind: 'lookup_planner',
    model: plannerModel,
    latencyMs: Date.now() - startedAt,
    attemptCount: completion.attemptCount,
    promptTokensEstimate,
    responseChars: raw.length,
    responsePreview: toSingleLinePreview(raw)
  });

  return {
    status: parsedDecision.status,
    decision: parsedDecision.decision,
    model: plannerModel,
    latencyMs: Date.now() - startedAt,
    attemptCount: completion.attemptCount,
    promptTokensEstimate
  };
}
