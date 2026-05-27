import { text } from '../../locales/locale.js';
import { buildIntentPrompt } from '../prompts.js';
import {
  estimateTokens,
  logLlmText,
  toSingleLinePreview,
  warnOnReplyFormatGuardrailViolation
} from './logging.js';
import { withRetry } from './retry.js';
import type {
  ChatCompletionsCreate,
  GenerateReplyInput,
  LlmClientConfig,
  LlmClientOptions,
  LlmReplyResult
} from './types.js';

export async function generateReply(params: {
  config: LlmClientConfig;
  createCompletion: ChatCompletionsCreate;
  options: LlmClientOptions;
  input: GenerateReplyInput;
}): Promise<LlmReplyResult> {
  const { config, createCompletion, options, input } = params;
  const prompt = buildIntentPrompt(input);
  const promptTokensEstimate = estimateTokens(prompt);
  const startedAt = Date.now();
  const replyModel = config.replyModel;

  logLlmText(options, 'llm.reply.request', {
    kind: 'reply',
    model: replyModel,
    temperature: config.replyTemperature,
    promptChars: prompt.length,
    promptTokensEstimate
  });

  const completion = await withRetry(
    () =>
      createCompletion({
        model: replyModel,
        temperature: config.replyTemperature,
        thinking: { type: 'disabled' },
        messages: [
          {
            role: 'system',
            content: text.llm.replySystem
          },
          {
            role: 'user',
            content: prompt
          }
        ]
      } as never),
    config
  );
  const reply = completion.value.choices[0]?.message.content?.trim();

  if (!reply) {
    throw new Error('Reply model returned empty content');
  }

  warnOnReplyFormatGuardrailViolation(options, input.intent, reply, replyModel);

  logLlmText(options, 'llm.reply.response', {
    kind: 'reply',
    model: replyModel,
    latencyMs: Date.now() - startedAt,
    attemptCount: completion.attemptCount,
    promptTokensEstimate,
    responseChars: reply.length,
    responsePreview: toSingleLinePreview(reply)
  });

  return {
    text: reply,
    model: replyModel,
    source: 'llm',
    latencyMs: Date.now() - startedAt,
    attemptCount: completion.attemptCount,
    promptTokensEstimate
  };
}
