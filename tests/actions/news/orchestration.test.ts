import { describe, expect, test, vi } from 'vitest';

import { newsAction } from '../../../src/app/actions/news/index.js';

describe('newsAction', () => {
  test('fetches public Telegram posts, builds a news prompt, calls LLM, and replies in private admin mode', async () => {
    const savedPosts: unknown[] = [];
    const sentMessages: string[] = [];
    const prompts: string[] = [];
    const html = `
      <div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="investblog_ru/100">
        <div class="tgme_widget_message_text js-message_text" dir="auto">Санкции и рынок</div>
        <time datetime="2026-05-20T08:00:00+00:00">08:00</time>
      </div>
      <div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="thedailyblogteam/200">
        <div class="tgme_widget_message_text js-message_text" dir="auto">Контекстная новость</div>
        <time datetime="2026-05-20T09:00:00+00:00">09:00</time>
      </div>
    `;
    const fetchMock = vi.fn(async (url: string) => {
      const slug = url.split('/').at(-1);
      const sourceHtml = html
        .replaceAll('investblog_ru', slug ?? '')
        .replaceAll('thedailyblogteam', slug ?? '');

      return new Response(sourceHtml);
    });

    await newsAction.handle({
      deps: {
        fetch: fetchMock,
        now: () => '2026-05-20T12:00:00.000Z',
        random: () => 0,
        delay: async () => {},
        bot: {
          userId: 77,
          username: 'bot',
          displayName: 'Bot'
        },
        db: {
          saveNewsPosts(posts: unknown[]) {
            savedPosts.push(...posts);
          },
          getNewsPosts() {
            return savedPosts;
          },
          getChatState: () => null,
          saveBotMessage: vi.fn()
        },
        qwen: {
          async analyzeNews(input: { prompt: string }) {
            prompts.push(input.prompt);

            return {
              text: 'Итог анализа',
              model: 'test-model',
              source: 'llm',
              latencyMs: 1,
              attemptCount: 1,
              promptTokensEstimate: 10
            };
          }
        },
        replyDispatcher: async ({ text }: { text: string }) => {
          sentMessages.push(text);

          return {
            messageId: 500,
            createdAt: '2026-05-20T12:00:01.000Z'
          };
        },
        logger: {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          child: vi.fn()
        }
      },
      mediaSupport: {},
      request: {
        chatId: 123,
        chatType: 'private',
        chatTitle: null,
        triggerMessageId: 10,
        fromDisplayName: 'Tom',
        createdAt: '2026-05-20T12:00:00.000Z',
        intent: 'news',
        replyToMessageSnapshot: null,
        replyToMediaSnapshot: null
      },
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn()
      }
    } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://t.me/s/investblog_ru',
      expect.any(Object)
    );
    expect(savedPosts.length).toBeGreaterThan(0);
    expect(prompts[0]).toContain('@investblog_ru: role=primary');
    expect(prompts[0]).toContain('@thedailyblogteam: role=context');
    expect(prompts[0]).toContain('Санкции и рынок');
    expect(prompts[0]).toContain('Контекстная новость');
    expect(prompts[0]).not.toContain('{{posts_by_source}}');
    expect(sentMessages).toEqual(['Итог анализа']);
  });

  test('warns in the private reply when a source returns no parsed posts', async () => {
    const savedPosts: unknown[] = [];
    const sentMessages: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      const slug = url.split('/').at(-1);

      if (slug === 'thedailyblogteam') {
        return new Response('<html><body>No public posts</body></html>');
      }

      return new Response(`
        <div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="${slug}/100">
          <div class="tgme_widget_message_text js-message_text" dir="auto">Новость ${slug}</div>
          <time datetime="2026-05-20T08:00:00+00:00">08:00</time>
        </div>
      `);
    });

    await newsAction.handle({
      deps: {
        fetch: fetchMock,
        now: () => '2026-05-20T12:00:00.000Z',
        random: () => 0,
        delay: async () => {},
        bot: {
          userId: 77,
          username: 'bot',
          displayName: 'Bot'
        },
        db: {
          saveNewsPosts(posts: unknown[]) {
            savedPosts.push(...posts);
          },
          getNewsPosts() {
            return savedPosts;
          },
          getChatState: () => null,
          saveBotMessage: vi.fn()
        },
        qwen: {
          async analyzeNews() {
            return {
              text: 'Итог анализа',
              model: 'test-model',
              source: 'llm',
              latencyMs: 1,
              attemptCount: 1,
              promptTokensEstimate: 10
            };
          }
        },
        replyDispatcher: async ({ text }: { text: string }) => {
          sentMessages.push(text);

          return {
            messageId: 501,
            createdAt: '2026-05-20T12:00:01.000Z'
          };
        },
        logger: {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          child: vi.fn()
        }
      },
      mediaSupport: {},
      request: {
        chatId: 123,
        chatType: 'private',
        chatTitle: null,
        triggerMessageId: 10,
        fromDisplayName: 'Tom',
        createdAt: '2026-05-20T12:00:00.000Z',
        intent: 'news',
        replyToMessageSnapshot: null,
        replyToMediaSnapshot: null
      },
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn()
      }
    } as never);

    expect(sentMessages[0]).toContain('WARN: не удалось получить данные');
    expect(sentMessages[0]).toContain('@thedailyblogteam');
  });

  test('splits long news analysis replies into Telegram-safe chunks', async () => {
    const savedPosts: unknown[] = [];
    const sentMessages: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      const slug = url.split('/').at(-1);

      return new Response(`
        <div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="${slug}/100">
          <div class="tgme_widget_message_text js-message_text" dir="auto">Новость ${slug}</div>
          <time datetime="2026-05-20T08:00:00+00:00">08:00</time>
        </div>
      `);
    });

    await newsAction.handle({
      deps: {
        fetch: fetchMock,
        now: () => '2026-05-20T12:00:00.000Z',
        random: () => 0,
        delay: async () => {},
        bot: {
          userId: 77,
          username: 'bot',
          displayName: 'Bot'
        },
        db: {
          saveNewsPosts(posts: unknown[]) {
            savedPosts.push(...posts);
          },
          getNewsPosts() {
            return savedPosts;
          },
          getChatState: () => null,
          saveBotMessage: vi.fn()
        },
        qwen: {
          async analyzeNews() {
            return {
              text: ['A'.repeat(3200), 'B'.repeat(3200)].join('\n\n'),
              model: 'test-model',
              source: 'llm',
              latencyMs: 1,
              attemptCount: 1,
              promptTokensEstimate: 10
            };
          }
        },
        replyDispatcher: async ({ text }: { text: string }) => {
          sentMessages.push(text);

          return {
            messageId: 502 + sentMessages.length,
            createdAt: '2026-05-20T12:00:01.000Z'
          };
        },
        logger: {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          child: vi.fn()
        }
      },
      mediaSupport: {},
      request: {
        chatId: 123,
        chatType: 'private',
        chatTitle: null,
        triggerMessageId: 10,
        fromDisplayName: 'Tom',
        createdAt: '2026-05-20T12:00:00.000Z',
        intent: 'news',
        replyToMessageSnapshot: null,
        replyToMediaSnapshot: null
      },
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn()
      }
    } as never);

    expect(sentMessages).toHaveLength(2);
    expect(sentMessages.every((message) => message.length <= 3500)).toBe(true);
    expect(sentMessages.join('')).toContain('A'.repeat(3200));
    expect(sentMessages.join('')).toContain('B'.repeat(3200));
  });
});
