import { describe, expect, test } from 'vitest';

import { OpenAiCompatibleLlmClient } from '../../src/llm/openai-compatible-client/index.js';
import { createClientConfig } from './support.js';

describe('OpenAiCompatibleLlmClient deploy update', () => {
  test('formats deploy updates with the reply model', async () => {
    let requestBody: Record<string, unknown> | undefined;
    const client = new OpenAiCompatibleLlmClient(createClientConfig(), {
      chat: {
        completions: {
          create: async (input: Record<string, unknown>) => {
            requestBody = input;

            return {
              choices: [
                {
                  message: {
                    content:
                      '<b>Исправлено</b>\n\n• Бот теперь понимает подписи к видео.'
                  }
                }
              ]
            };
          }
        }
      }
    } as never);

    await expect(
      client.formatDeployUpdate({
        shortSha: '9c59b85',
        commits: ['fix: handle telegram media captions']
      })
    ).resolves.toMatchObject({
      text: '<b>Исправлено</b>\n\n• Бот теперь понимает подписи к видео.',
      model: 'reply-model'
    });

    expect(requestBody).toEqual(
      expect.objectContaining({
        model: 'reply-model',
        temperature: 0.4,
        max_tokens: 500,
        enable_thinking: false
      })
    );
    expect(
      (
        requestBody?.messages as
          | Array<{ role: string; content: string }>
          | undefined
      )?.[1]?.content
    ).toContain('fix: handle telegram media captions');
  });
});
