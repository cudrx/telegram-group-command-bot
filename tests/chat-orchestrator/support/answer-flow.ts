import { vi } from 'vitest';

import { OpenAiCompatibleLlmClient } from '../../../src/llm/openai-compatible-client/index.js';
import {
  createIncomingMessage,
  createOrchestrator,
  FakeDatabaseClient
} from '../support.js';

export function createAnswerFlow(
  replies: unknown[],
  options: {
    search?: (input: {
      query: string;
      maxResults: number;
      timeoutMs: number;
    }) => Promise<unknown>;
    lookupDisabled?: boolean;
  } = {}
) {
  const db = new FakeDatabaseClient();
  db.saveIncomingMessage(
    createIncomingMessage({
      messageId: 1,
      text: 'PostgreSQL поддерживает транзакции.'
    })
  );
  db.saveIncomingMessage(
    createIncomingMessage({ messageId: 2, text: 'На море едем поездом.' })
  );
  const requests: Array<{
    messages: Array<{ role: string; content: string }>;
  }> = [];
  const llm = new OpenAiCompatibleLlmClient(
    {
      apiKey: 'test-key',
      baseUrl: 'https://example.com',
      replyModel: 'test-model',
      replyTemperature: 0.6,
      timeoutMs: 1000,
      maxRetries: 0
    },
    {
      chat: {
        completions: {
          create: async (request: (typeof requests)[number]) => {
            requests.push(request);
            const reply = replies.shift();
            if (reply instanceof Error) throw reply;

            return {
              choices: [
                {
                  message: {
                    content:
                      typeof reply === 'string' ? reply : JSON.stringify(reply)
                  }
                }
              ]
            };
          }
        }
      }
    } as never
  );
  const search = vi.fn(
    options.search ??
      (async () => ({
        provider: 'tavily',
        query: 'PostgreSQL',
        sources: [
          {
            title: 'Docs',
            url: 'https://example.com/docs',
            content: 'Transactions are supported.',
            score: 1
          }
        ],
        responseTimeMs: 1,
        usageCredits: 1
      }))
  );
  const replyDispatcher = vi
    .fn()
    .mockResolvedValue({ messageId: 1001, createdAt: '2026-10-24T12:00:00Z' });
  const orchestrator = createOrchestrator({
    db,
    qwen: {
      generateAnswer: (input) => llm.generateAnswer(input),
      generateReply: vi.fn()
    },
    replyDispatcher,
    lookupProvider: options.lookupDisabled ? null : { search: search as never }
  });

  return {
    db,
    requests,
    search,
    replyDispatcher,
    run: (text = '@fun_bot проверь утверждение про PostgreSQL') =>
      orchestrator.handleIncomingMessage(
        createIncomingMessage({
          messageId: 3,
          text,
          entities: [{ type: 'mention', offset: 0, length: 8 }]
        })
      )
  };
}
