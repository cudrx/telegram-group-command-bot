import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { fetchRedditListingCandidates } from '../../../src/app/actions/meme/reddit-listing-client.js';
import { fetchRedditPostCandidate } from '../../../src/app/actions/meme/reddit-post-client.js';
import { createNotifyingLogger } from '../../../src/app/admin-notifier.js';
import { createIncomingMessage } from '../../database/support.js';
import { FakeDatabaseClient } from '../support/fake-database.js';
import { createLogger } from '../support/logger.js';
import { createOrchestrator } from '../support/orchestrator.js';

describe('Reddit cookie header rejection', () => {
  test('warns the admin for every denied listing on repeated meme requests', async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'reddit-header-warning-')
    );
    const headerPath = path.join(directory, 'header.txt');
    await writeFile(headerPath, 'reddit_session=secret-session');
    const messages: string[] = [];
    const logger = createNotifyingLogger(createLogger(), {
      async notify(message) {
        messages.push(message);
      }
    });
    const fetch = vi.fn(async () => new Response('denied', { status: 403 }));
    const orchestrator = createOrchestrator({
      db: new FakeDatabaseClient(),
      qwen: { generateReply: vi.fn() },
      env: { redditCookieHeaderPath: headerPath },
      logger,
      fetch,
      replyDispatcher: vi.fn(async () => ({
        messageId: 500,
        createdAt: '2026-05-11T10:00:00.000Z'
      }))
    });
    try {
      for (const messageId of [100, 101]) {
        await orchestrator.handleIncomingMessage(
          createIncomingMessage({
            messageId,
            text: '/meme',
            entities: [{ type: 'bot_command', offset: 0, length: 5 }]
          })
        );
      }
      expect(messages.length).toBeGreaterThan(1);
      expect(messages).toHaveLength(fetch.mock.calls.length);
      expect(messages[0]).toContain('HTTP 403');
      expect(messages[0]).toContain('REDDIT_COOKIE_HEADER_PATH');
      expect(messages[0]).not.toContain('secret-session');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test.each([
    401, 403
  ])('identifies HTTP %i for listings and posts without leaking cookies', async (status) => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'reddit-header-warning-')
    );
    const headerPath = path.join(directory, 'header.txt');
    await writeFile(headerPath, 'reddit_session=secret-session');
    const fetch = vi.fn(async () => new Response('denied', { status }));

    try {
      const requests = [
        () =>
          fetchRedditListingCandidates({
            subreddit: 'memes',
            count: 10,
            redditCookieHeaderPath: headerPath,
            fetch
          }),
        () =>
          fetchRedditPostCandidate({
            text: 'https://www.reddit.com/r/nba/comments/abc/post/',
            redditCookieHeaderPath: headerPath,
            fetch
          }),
        () =>
          fetchRedditPostCandidate({
            text: 'https://www.reddit.com/r/nba/s/token',
            redditCookieHeaderPath: headerPath,
            fetch
          })
      ];
      for (const request of requests) {
        await expect(request()).rejects.toMatchObject({
          name: 'RedditCookieHeaderRejectedError',
          status
        });
        await expect(request()).rejects.not.toThrow('secret-session');
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('does not label an empty listing or a missing subreddit as expired cookies', async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'reddit-header-warning-')
    );
    const headerPath = path.join(directory, 'header.txt');
    await writeFile(headerPath, 'reddit_session=secret-session');
    try {
      for (const response of [
        new Response('{"data":{"children":[]}}'),
        new Response('missing', { status: 404 })
      ]) {
        await expect(
          fetchRedditListingCandidates({
            subreddit: 'memes',
            count: 10,
            redditCookieHeaderPath: headerPath,
            fetch: vi.fn(async () => response)
          })
        ).resolves.toEqual([]);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
