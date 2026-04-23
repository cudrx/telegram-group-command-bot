import { describe, expect, test } from 'vitest';

import { OpenAiCompatibleLlmClient } from '../../src/llm/openai-compatible-client/index.js';
import { createClientConfig, createReplyInput } from './support.js';

describe('OpenAiCompatibleLlmClient retry', () => {
  test('retries retryable completion errors once', async () => {
    let calls = 0;
    const client = new OpenAiCompatibleLlmClient(
      {
        ...createClientConfig(),
        maxRetries: 1
      },
      {
        chat: {
          completions: {
            create: async () => {
              calls += 1;

              if (calls === 1) {
                const error = new Error('temporary failure') as Error & {
                  status: number;
                };

                error.status = 500;
                throw error;
              }

              return {
                choices: [
                  {
                    message: {
                      content: 'ready'
                    }
                  }
                ]
              };
            }
          }
        }
      } as never
    );

    await expect(
      client.generateReply(createReplyInput())
    ).resolves.toMatchObject({
      text: 'ready',
      model: 'reply-model',
      attemptCount: 2
    });
    expect(calls).toBe(2);
  });
});
