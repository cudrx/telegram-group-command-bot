import { z } from 'zod';

import type { ReplyContext } from '../../domain/models.js';
import { loadPrompt } from '../prompt-files.js';
import { getIntentDataSections } from '../prompts/data-sections.js';
import { formatJsonForPrompt } from '../prompts/sanitize.js';
import type { DescribeMediaContext } from '../prompts/types.js';
import { estimateTokens } from './logging.js';
import { withRetry } from './retry.js';
import type { ChatCompletionsCreate, LlmClientConfig } from './types.js';

const researchPlanSchema = z
  .object({
    resolvedQuestion: z.string().trim().min(1),
    purpose: z.enum([
      'entity_grounding',
      'fact_check',
      'freshness',
      'link_extraction'
    ]),
    focusClaim: z.string().trim().min(1),
    query: z.string().trim().min(1)
  })
  .strict();

const preflightSchema = z.discriminatedUnion('mode', [
  z
    .object({ mode: z.literal('direct'), text: z.string().trim().min(1) })
    .strict(),
  researchPlanSchema.extend({ mode: z.literal('research') }).strict()
]);

const groundedSchema = z
  .object({
    mode: z.literal('grounded'),
    status: z.enum(['answered', 'insufficient']),
    outcome: z.enum([
      'confirmed',
      'narrowed',
      'corrected',
      'conflicted',
      'insufficient'
    ]),
    evidenceBasis: z.enum([
      'original_source',
      'independent_reporting',
      'derivative_only',
      'none'
    ]),
    usedSourceIds: z.array(z.string().trim().min(1)),
    text: z.string().trim().min(1)
  })
  .strict();

export type AnswerResearchPlan = z.infer<typeof researchPlanSchema>;
export type AnswerDecision =
  | z.infer<typeof preflightSchema>
  | z.infer<typeof groundedSchema>;

export type AnswerResearchContext = {
  plan: AnswerResearchPlan;
  result: {
    query: string;
    sources: Array<{
      id: string;
      title: string;
      url: string;
      content: string;
      score: number | null;
    }>;
  };
};

export type GenerateAnswerInput = {
  assistantInstructions: string;
  targetDisplayName: string;
  currentDateTime: string;
  replyContext: ReplyContext;
  mediaContext?: DescribeMediaContext | null;
  research?: AnswerResearchContext;
};

export type GenerateAnswerResult = {
  decision: AnswerDecision;
  model: string;
  latencyMs: number;
  attemptCount: number;
  promptTokensEstimate: number;
};

export async function generateAnswer(input: {
  config: LlmClientConfig;
  createCompletion: ChatCompletionsCreate;
  request: GenerateAnswerInput;
}): Promise<GenerateAnswerResult> {
  const schema = input.request.research ? groundedSchema : preflightSchema;
  const prompt = buildPrompt(input.request, schema);
  const startedAt = Date.now();
  const promptTokensEstimate = estimateTokens(prompt);
  const completion = await withRetry(
    () =>
      input.createCompletion({
        model: input.config.replyModel,
        temperature: input.config.replyTemperature,
        thinking: { type: 'disabled' },
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'Return one valid JSON object for a Telegram answer.'
          },
          { role: 'user', content: prompt }
        ]
      } as never),
    input.config
  );
  const raw = completion.value.choices[0]?.message.content?.trim();

  if (!raw) throw new Error('Answer model returned empty content');

  const decision = schema.parse(JSON.parse(raw)) as AnswerDecision;

  if (decision.mode === 'grounded') {
    const allowed = new Set(
      input.request.research?.result.sources.map((source) => source.id)
    );

    for (const sourceId of decision.usedSourceIds) {
      if (!allowed.has(sourceId)) {
        throw new Error(`Unknown answer evidence source: ${sourceId}`);
      }
    }
  }

  return {
    decision,
    model: input.config.replyModel,
    latencyMs: Date.now() - startedAt,
    attemptCount: completion.attemptCount,
    promptTokensEstimate
  };
}

function buildPrompt(
  input: GenerateAnswerInput,
  schema: typeof preflightSchema | typeof groundedSchema
): string {
  return [
    input.assistantInstructions,
    `Current date and time: ${input.currentDateTime}`,
    loadPrompt('answer'),
    loadPrompt(input.research ? 'answerGrounded' : 'answerPreflight'),
    getIntentDataSections({
      intent: 'answer',
      replyContext: input.replyContext,
      mediaContext: input.mediaContext ?? null
    }),
    input.research ? `RESEARCH:\n${formatJsonForPrompt(input.research)}` : '',
    `OUTPUT_CONTRACT:\n${formatJsonForPrompt(z.toJSONSchema(schema))}`
  ]
    .filter(Boolean)
    .join('\n\n');
}
