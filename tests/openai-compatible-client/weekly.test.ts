import { describe, expect, test } from 'vitest';

import { OpenAiCompatibleLlmClient } from '../../src/llm/openai-compatible-client/index.js';
import { loadPrompt } from '../../src/llm/prompt-files.js';
import { createClientConfig } from './support.js';

describe('OpenAiCompatibleLlmClient weekly', () => {
  test('uses the reply model and weekly prompt contract for weekly reports', async () => {
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
                    content: '<b>Неделя в чате</b>'
                  }
                }
              ]
            };
          }
        }
      }
    } as never);

    await client.generateWeekly({
      assistantInstructions: loadPrompt('base'),
      weeklyDataset: 'WEEK_STATS\n- total human messages: 42'
    });

    expect(requestBody?.model).toBe('reply-model');
    expect(requestBody?.temperature).toBe(0.6);
    expect(JSON.stringify(requestBody)).toContain('Неделя в чате');
    expect(JSON.stringify(requestBody)).toContain('SELECTED_EVENTS');
    expect(JSON.stringify(requestBody)).toContain(
      'WEEK_STATS\\n- total human messages: 42'
    );
  });
});
