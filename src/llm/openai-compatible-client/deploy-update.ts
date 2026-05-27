import { llmProviderConfig } from '../../config/runtime/index.js';
import { text } from '../../locales/locale.js';
import { buildDeployUpdatePrompt } from '../deploy-update-prompt.js';
import { estimateTokens, logLlmText, toSingleLinePreview } from './logging.js';
import { withRetry } from './retry.js';
import type {
  ChatCompletionsCreate,
  LlmClientConfig,
  LlmClientOptions,
  LlmReplyResult
} from './types.js';

export async function formatDeployUpdate(params: {
  config: LlmClientConfig;
  createCompletion: ChatCompletionsCreate;
  options: LlmClientOptions;
  input: {
    shortSha: string;
    commits: string[];
  };
}): Promise<LlmReplyResult> {
  const { config, createCompletion, options, input } = params;
  const prompt = buildDeployUpdatePrompt(input);
  const promptTokensEstimate = estimateTokens(prompt);
  const startedAt = Date.now();
  const model = config.replyModel;

  logLlmText(options, 'llm.deploy_update.request', {
    kind: 'deploy_update',
    model,
    temperature: llmProviderConfig.deployUpdate.temperature,
    promptChars: prompt.length,
    promptTokensEstimate
  });

  const completion = await withRetry(
    () =>
      createCompletion({
        model,
        temperature: llmProviderConfig.deployUpdate.temperature,
        max_tokens: llmProviderConfig.deployUpdate.maxTokens,
        thinking: { type: 'disabled' },
        messages: [
          {
            role: 'system',
            content: text.llm.deployUpdateSystem
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
    throw new Error('Deploy update model returned empty content');
  }

  logLlmText(options, 'llm.deploy_update.response', {
    kind: 'deploy_update',
    model,
    latencyMs: Date.now() - startedAt,
    attemptCount: completion.attemptCount,
    promptTokensEstimate,
    responseChars: reply.length,
    responsePreview: toSingleLinePreview(reply)
  });

  return {
    text: reply,
    model,
    source: 'llm',
    latencyMs: Date.now() - startedAt,
    attemptCount: completion.attemptCount,
    promptTokensEstimate
  };
}
