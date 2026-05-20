import { estimateTokens, logLlmText, toSingleLinePreview } from './logging.js';
import { withRetry } from './retry.js';
import type {
  ChatCompletionsCreate,
  LlmClientConfig,
  LlmClientOptions,
  LlmReplyResult
} from './types.js';

export async function analyzeNews(params: {
  config: LlmClientConfig;
  createCompletion: ChatCompletionsCreate;
  options: LlmClientOptions;
  input: { prompt: string };
}): Promise<LlmReplyResult> {
  const { config, createCompletion, options, input } = params;
  const promptTokensEstimate = estimateTokens(input.prompt);
  const startedAt = Date.now();
  const replyModel = config.replyModel;

  logLlmText(options, 'llm.news.request', {
    kind: 'news',
    model: replyModel,
    temperature: config.replyTemperature,
    promptChars: input.prompt.length,
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
            content:
              'You are a neutral analytical assistant. Answer in Russian.'
          },
          {
            role: 'user',
            content: input.prompt
          }
        ]
      } as never),
    config
  );
  const reply = completion.value.choices[0]?.message.content?.trim();

  if (!reply) {
    throw new Error('News analysis model returned empty content');
  }

  logLlmText(options, 'llm.news.response', {
    kind: 'news',
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
