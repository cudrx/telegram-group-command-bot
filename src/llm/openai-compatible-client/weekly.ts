import { loadPrompt } from '../prompt-files.js';
import { renderPromptTemplate } from '../prompts/render.js';
import { estimateTokens, logLlmText, toSingleLinePreview } from './logging.js';
import { withRetry } from './retry.js';
import type {
  ChatCompletionsCreate,
  GenerateWeeklyInput,
  LlmClientConfig,
  LlmClientOptions,
  LlmReplyResult
} from './types.js';

export async function generateWeekly(params: {
  config: LlmClientConfig;
  createCompletion: ChatCompletionsCreate;
  options: LlmClientOptions;
  input: GenerateWeeklyInput;
}): Promise<LlmReplyResult> {
  const { config, createCompletion, options, input } = params;
  const prompt = renderPromptTemplate(loadPrompt('replyShell'), {
    assistantInstructions: input.assistantInstructions,
    globalPrompt: loadPrompt('global'),
    targetDisplayName: 'weekly-report',
    intent: 'weekly',
    intentPrompt: loadPrompt('weekly'),
    dataSections: input.weeklyDataset,
    lookupSections: ''
  });
  const promptTokensEstimate = estimateTokens(prompt);
  const startedAt = Date.now();
  const replyModel = config.replyModel;

  logLlmText(options, 'llm.weekly.request', {
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
        enable_thinking: config.replyEnableThinking ?? false,
        messages: [
          {
            role: 'system',
            content:
              'You are a neutral Telegram assistant. Respond with a concise Russian weekly chat recap in Telegram HTML.'
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
    throw new Error('Weekly reply model returned empty content');
  }

  logLlmText(options, 'llm.weekly.response', {
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
    latencyMs: Date.now() - startedAt,
    attemptCount: completion.attemptCount,
    promptTokensEstimate
  };
}
