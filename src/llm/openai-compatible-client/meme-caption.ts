import { loadPrompt } from '../prompt-files.js';
import { renderPromptTemplate } from '../prompts/render.js';
import { estimateTokens, logLlmText, toSingleLinePreview } from './logging.js';
import { withRetry } from './retry.js';
import type {
  ChatCompletionsCreate,
  GenerateMemeCaptionInput,
  LlmClientConfig,
  LlmClientOptions,
  LlmReplyResult
} from './types.js';

export async function generateMemeCaption(params: {
  config: LlmClientConfig;
  createCompletion: ChatCompletionsCreate;
  options: LlmClientOptions;
  input: GenerateMemeCaptionInput;
}): Promise<LlmReplyResult> {
  const { config, createCompletion, options, input } = params;
  const prompt = renderPromptTemplate(
    `${loadPrompt('memeCaption')}

REDDIT_TITLE:
{{title}}

SUBREDDIT:
r/{{subreddit}}

UPVOTES:
{{upvotes}}

PERMALINK:
{{permalink}}

MEDIA_KIND:
{{mediaKind}}`,
    {
      title: input.title,
      subreddit: input.subreddit,
      upvotes: String(input.upvotes),
      permalink: input.permalink,
      mediaKind: input.mediaKind
    }
  );
  const promptTokensEstimate = estimateTokens(prompt);
  const startedAt = Date.now();
  const model = config.replyModel;

  logLlmText(options, 'llm.meme_caption.request', {
    kind: 'reply',
    model,
    temperature: config.replyTemperature,
    promptChars: prompt.length,
    promptTokensEstimate
  });

  const completion = await withRetry(
    () =>
      createCompletion({
        model,
        temperature: config.replyTemperature,
        thinking: { type: 'disabled' },
        messages: [
          {
            role: 'system',
            content:
              'You localize Reddit meme titles into concise natural Russian captions.'
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
    throw new Error('Meme caption model returned empty content');
  }

  logLlmText(options, 'llm.meme_caption.response', {
    kind: 'reply',
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
