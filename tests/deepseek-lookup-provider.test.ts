import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  createAdminNotifier,
  createNotifyingLogger
} from '../src/app/admin-notifier.js';
import { createOptionalProviders } from '../src/app/providers.js';
import { createLogger } from '../src/logging/logger.js';
import { createEnv } from './chat-orchestrator/support/env.js';

const input = {
  query: 'PostgreSQL transactions',
  maxResults: 3,
  timeoutMs: 7000
};

function setup(tavilyApiKey: string | null = 'tavily-key') {
  const notices: string[] = [];
  const logger = createNotifyingLogger(
    createLogger({}, { level: 'error', color: false }),
    createAdminNotifier({
      adminChatId: 42,
      sendMessage: async ({ text }) => {
        notices.push(text);
      }
    })
  );
  const { lookupProvider } = createOptionalProviders(
    createEnv({
      lookupProvider: 'deepseek',
      deepseekApiKey: 'deepseek-key',
      tavilyApiKey
    }),
    logger
  );
  if (!lookupProvider)
    throw new Error('DeepSeek lookup provider is not configured');

  return { provider: lookupProvider, notices };
}

function tavilyResponse() {
  return Response.json({
    results: [
      {
        title: 'Tavily source',
        url: 'https://example.test/tavily',
        content: 'Fallback evidence',
        score: 0.9
      }
    ],
    usage: { credits: 1 }
  });
}

describe('DeepSeek search with Tavily failover', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('uses DeepSeek summaries without fetching raw pages or warning the admin', async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        results: [
          {
            title: 'Official docs',
            url: 'https://example.test/docs',
            summary: 'Transactions are supported.',
            snippet: 'Short snippet',
            content: 'Huge page'.repeat(10000),
            rerank_score: 2.4
          }
        ]
      })
    );
    vi.stubGlobal('fetch', fetch);
    const { provider, notices } = setup();

    const result = await provider.search(input);

    expect(result).toMatchObject({
      provider: 'deepseek',
      query: input.query,
      usageCredits: null,
      sources: [
        {
          title: 'Official docs',
          url: 'https://example.test/docs',
          content: 'Transactions are supported.',
          score: 2.4
        }
      ]
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.deepseek.com/v1/tools/search',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer deepseek-key',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          query: input.query,
          count: 3,
          need_content: false
        }),
        signal: expect.any(AbortSignal)
      })
    );
    expect(notices).toEqual([]);
  });

  test.each([
    ['empty results', () => Response.json({ results: [] })],
    [
      'unusable results',
      () =>
        Response.json({ results: [{ title: 'No URL', summary: 'Evidence' }] })
    ],
    ['server error', () => new Response('unavailable', { status: 503 })],
    ['invalid JSON', () => new Response('<html>bad gateway</html>')],
    [
      'timeout',
      () => {
        throw new DOMException('Timed out', 'TimeoutError');
      }
    ],
    [
      'network error',
      () => {
        throw new TypeError('fetch failed');
      }
    ]
  ])('warns the admin and tries Tavily once after DeepSeek %s, without retrying DeepSeek', async (_label, response) => {
    const fetch = vi
      .fn()
      .mockImplementationOnce(response)
      .mockResolvedValueOnce(tavilyResponse());
    vi.stubGlobal('fetch', fetch);
    const { provider, notices } = setup();

    const result = await provider.search(input);

    expect(result).toMatchObject({
      provider: 'tavily',
      sources: [{ content: 'Fallback evidence' }]
    });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://api.deepseek.com/v1/tools/search',
      'https://api.tavily.com/search'
    ]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('WARN: deepseek_search_fallback:');
    expect(notices[0]).not.toContain('deepseek-key');
    expect(notices[0]).toContain('Tavily');
  });

  test('fails visibly after both services fail rather than returning fabricated sources', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ results: [] }))
        .mockResolvedValueOnce(new Response('forbidden', { status: 403 }))
    );
    const { provider, notices } = setup();

    await expect(provider.search(input)).rejects.toThrow(
      'Tavily lookup failed with status 403'
    );
    expect(notices).toHaveLength(1);
  });

  test('warns even when the Tavily fallback key is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ results: [] }))
    );
    const { provider, notices } = setup(null);

    await expect(provider.search(input)).rejects.toThrow('no usable results');
    expect(notices).toHaveLength(1);
  });

  test('uses snippets when a summary is empty and ignores malformed rows', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          results: [
            null,
            { title: '', url: 'https://example.test', summary: 'drop' },
            {
              title: 'Snippet source',
              url: 'https://example.test/snippet',
              summary: ' ',
              snippet: 'Snippet evidence',
              rerank_score: null
            }
          ]
        })
      )
    );
    const { provider } = setup();

    await expect(provider.search(input)).resolves.toMatchObject({
      provider: 'deepseek',
      sources: [
        { title: 'Snippet source', content: 'Snippet evidence', score: null }
      ]
    });
  });

  test('sends a query outside the DeepSeek limit to Tavily without truncating it', async () => {
    const fetch = vi.fn().mockResolvedValue(tavilyResponse());
    vi.stubGlobal('fetch', fetch);
    const { provider, notices } = setup();
    const query = 'я'.repeat(129);

    await expect(provider.search({ ...input, query })).resolves.toMatchObject({
      provider: 'tavily',
      query
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.tavily.com/search');
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body).query).toBe(query);
    expect(notices).toHaveLength(1);
  });

  test('counts the query limit in Unicode characters rather than UTF-16 code units', async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        results: [
          {
            title: 'Source',
            url: 'https://example.test',
            summary: 'Evidence',
            rerank_score: 2
          }
        ]
      })
    );
    vi.stubGlobal('fetch', fetch);
    const { provider, notices } = setup();
    const query = '🙂'.repeat(128);

    await expect(provider.search({ ...input, query })).resolves.toMatchObject({
      provider: 'deepseek',
      query
    });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://api.deepseek.com/v1/tools/search'
    ]);
    expect(notices).toEqual([]);
  });
});
