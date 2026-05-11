import { describe, expect, test } from 'vitest';

import { OpenAiCompatibleLlmClient } from '../../src/llm/openai-compatible-client/index.js';
import { createClientConfig } from './support.js';

describe('OpenAiCompatibleLlmClient meme captions', () => {
  test('localizes meme captions with the reply model', async () => {
    let requestBody: Record<string, unknown> | undefined;
    const client = new OpenAiCompatibleLlmClient(createClientConfig(), {
      chat: {
        completions: {
          create: async (input: Record<string, unknown>) => {
            requestBody = input;

            return {
              choices: [{ message: { content: 'Это правда.' } }]
            };
          }
        }
      }
    } as never);

    const result = await client.generateMemeCaption({
      title: "It's true.",
      subreddit: 'memes',
      upvotes: 50_592,
      permalink: '/r/memes/comments/abc/its_true/',
      mediaKind: 'image'
    });

    expect(result.text).toBe('Это правда.');
    expect(requestBody).toEqual(
      expect.objectContaining({
        model: 'reply-model',
        temperature: 0.6,
        thinking: { type: 'disabled' }
      })
    );
    expect(
      (
        requestBody?.messages as
          | Array<{ role: string; content: string }>
          | undefined
      )?.[1]?.content
    ).toContain("It's true.");
  });
});
