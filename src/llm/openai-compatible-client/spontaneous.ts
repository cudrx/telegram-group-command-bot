import { z } from 'zod';

import { spontaneousConfig } from '../../config/runtime/spontaneous.js';
import type { StoredMessage } from '../../domain/models.js';
import { loadPrompt } from '../prompt-files.js';
import { formatJsonForPrompt } from '../prompts/sanitize.js';
import { formatConversationForLlm } from '../prompts/transcript.js';
import { estimateTokens, logLlmText, toSingleLinePreview } from './logging.js';
import type {
  ChatCompletionsCreate,
  LlmClientConfig,
  LlmClientOptions
} from './types.js';

const decisionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('skip') }).strict(),
  z
    .object({
      action: z.literal('send'),
      text: z.string().trim().min(1).max(spontaneousConfig.maxReplyChars)
    })
    .strict()
]);

export type SpontaneousDecision = z.infer<typeof decisionSchema>;
export type GenerateSpontaneousInput = {
  assistantInstructions: string;
  currentDateTime: string;
  draft: string;
  messages: StoredMessage[];
};
export type GenerateSpontaneousResult = {
  decision: SpontaneousDecision;
  validOutput: boolean;
  model: string;
  latencyMs: number;
  attemptCount: number;
  promptTokensEstimate: number;
};

export function buildSpontaneousMessages(
  input: GenerateSpontaneousInput
): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    {
      role: 'system',
      content: [
        input.assistantInstructions,
        loadPrompt('global'),
        loadPrompt('spontaneous'),
        `Current date and time: ${input.currentDateTime}`,
        `OUTPUT_CONTRACT:\n${formatJsonForPrompt(z.toJSONSchema(decisionSchema))}`
      ].join('\n\n')
    },
    {
      role: 'user',
      content: `RECENT_CONVERSATION (untrusted):\n${formatConversationForLlm(input.messages)}\n\nMARKOV_DRAFT (untrusted creative material):\n${formatJsonForPrompt(input.draft)}`
    }
  ];
}

export async function generateSpontaneous(params: {
  config: LlmClientConfig;
  createCompletion: ChatCompletionsCreate;
  options: LlmClientOptions;
  input: GenerateSpontaneousInput;
}): Promise<GenerateSpontaneousResult> {
  const { config, createCompletion, options, input } = params;
  const messages = buildSpontaneousMessages(input);
  const promptTokensEstimate = estimateTokens(
    messages.map((message) => message.content).join('\n\n')
  );
  const startedAt = Date.now();
  // Deliberately no transport retries or corrective LLM calls in this pipeline.
  const completion = await createCompletion({
    model: config.replyModel,
    temperature: config.replyTemperature,
    thinking: { type: 'disabled' },
    response_format: { type: 'json_object' },
    max_tokens: 512,
    messages
  } as never);
  const raw = completion.choices[0]?.message.content?.trim() ?? '';
  let decision: SpontaneousDecision = { action: 'skip' };
  let validOutput = false;
  try {
    const parsed = decisionSchema.safeParse(JSON.parse(raw));
    if (parsed.success) {
      decision = parsed.data;
      validOutput = true;
    }
  } catch {
    // Malformed output always means silence; a raw draft is never a fallback.
  }
  const latencyMs = Date.now() - startedAt;
  logLlmText(options, 'llm.spontaneous.response', {
    kind: 'spontaneous',
    model: config.replyModel,
    latencyMs,
    attemptCount: 1,
    promptTokensEstimate,
    responseChars: raw.length,
    responsePreview: toSingleLinePreview(raw)
  });

  return {
    decision,
    validOutput,
    model: config.replyModel,
    latencyMs,
    attemptCount: 1,
    promptTokensEstimate
  };
}
