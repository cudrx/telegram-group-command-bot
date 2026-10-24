import { describe, expect, test, vi } from 'vitest';

import { OpenAiCompatibleLlmClient } from '../../src/llm/openai-compatible-client/index.js';
import {
  createClientConfig,
  createOpenAiStub,
  createReplyInput
} from './support.js';

describe('OpenAiCompatibleLlmClient reply', () => {
  test('logs compact reply trace without raw prompt or response fields', async () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn()
    };

    logger.child.mockReturnValue(logger);

    const client = new OpenAiCompatibleLlmClient(
      createClientConfig(),
      createOpenAiStub('ready'),
      {
        logger,
        logLlmText: true
      }
    );

    await client.generateReply(createReplyInput());

    expect(logger.info).toHaveBeenCalledWith(
      'llm.reply.request',
      expect.objectContaining({
        kind: 'reply',
        model: 'reply-model',
        promptChars: expect.any(Number),
        promptTokensEstimate: expect.any(Number)
      })
    );
    expect(logger.info).toHaveBeenCalledWith(
      'llm.reply.response',
      expect.objectContaining({
        kind: 'reply',
        model: 'reply-model',
        responseChars: 5,
        responsePreview: 'ready'
      })
    );
    expect(logger.info).not.toHaveBeenCalledWith(
      'llm.reply.request',
      expect.objectContaining({
        prompt: expect.any(String)
      })
    );
    expect(logger.info).not.toHaveBeenCalledWith(
      'llm.reply.response',
      expect.objectContaining({
        response: expect.any(String)
      })
    );
  });

  test('warns when reply output violates formatting guardrails', async () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn()
    };

    logger.child.mockReturnValue(logger);

    const client = new OpenAiCompatibleLlmClient(
      createClientConfig(),
      createOpenAiStub('Summary:\n**Коротко**'),
      {
        logger
      }
    );

    await client.generateReply(createReplyInput());

    expect(logger.warn).toHaveBeenCalledWith(
      'llm.reply_format_guardrail_warning',
      expect.objectContaining({
        kind: 'reply',
        model: 'reply-model',
        intent: 'translate',
        hasEnglishSummaryHeading: true,
        hasMarkdownBold: true,
        violations: expect.arrayContaining([
          'english_summary_heading',
          'markdown_bold'
        ])
      })
    );
  });

  test('uses only reply request settings', async () => {
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
                    content: 'ready'
                  }
                }
              ]
            };
          }
        }
      }
    } as never);

    await client.generateReply(createReplyInput());

    expect(requestBody?.model).toBe('reply-model');
    expect(requestBody?.temperature).toBe(0.6);
    expect(requestBody?.thinking).toEqual({ type: 'disabled' });
    expect(requestBody).not.toHaveProperty('enable_thinking');
    const messages = requestBody?.messages as
      | Array<{ role: string; content: string }>
      | undefined;

    expect(messages?.map((message) => message.role)).toEqual([
      'system',
      'user'
    ]);
    expect(messages?.[1]?.content).toContain('Assistant instructions');
  });

  test('routes all reply intents to the reply model', async () => {
    const requestBodies: Record<string, unknown>[] = [];
    const client = new OpenAiCompatibleLlmClient(createClientConfig(), {
      chat: {
        completions: {
          create: async (input: Record<string, unknown>) => {
            requestBodies.push(input);

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
    } as never);

    await client.generateReply(createReplyInput('translate'));
    await client.generateReply(createReplyInput('read'));

    expect(requestBodies.map((body) => body.model)).toEqual([
      'reply-model',
      'reply-model'
    ]);
  });
});
