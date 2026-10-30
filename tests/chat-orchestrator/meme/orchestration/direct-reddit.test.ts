import { existsSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import { createIncomingMessage } from '../../../database/support.js';
import { FakeDatabaseClient } from '../../support/fake-database.js';
import { createOrchestrator } from '../../support/orchestrator.js';

const cases = [
  {
    kind: 'image',
    sourceUrl:
      'https://www.reddit.com/r/memes/comments/imgdirect/direct_image/',
    post: {
      id: 'imgdirect',
      subreddit: 'memes',
      title: 'direct image',
      permalink: '/r/memes/comments/imgdirect/direct_image/',
      ups: 1234,
      url: 'https://i.redd.it/direct-image.jpeg'
    },
    mediaUrls: ['https://i.redd.it/direct-image.jpeg'],
    wantCaption:
      'direct image\n\nr/memes · <a href="https://www.reddit.com/r/memes/comments/imgdirect/direct_image/">↑1234</a> · <a href="https://t.me/tom">@tom</a>'
  },
  {
    kind: 'animation',
    sourceUrl: 'https://www.reddit.com/r/memes/comments/gifdirect/direct_gif/',
    post: {
      id: 'gifdirect',
      subreddit: 'memes',
      title: 'direct GIF',
      permalink: '/r/memes/comments/gifdirect/direct_gif/',
      ups: 1234,
      url: 'https://i.redd.it/direct-animation.gif'
    },
    mediaUrls: ['https://i.redd.it/direct-animation.gif'],
    wantCaption:
      'direct GIF\n\nr/memes · <a href="https://www.reddit.com/r/memes/comments/gifdirect/direct_gif/">↑1234</a> · <a href="https://t.me/tom">@tom</a>'
  },
  {
    kind: 'gallery',
    sourceUrl: 'https://www.reddit.com/r/pics/s/shareToken',
    post: {
      id: 'galdirect',
      subreddit: 'pics',
      title: 'direct gallery',
      permalink: '/r/pics/comments/galdirect/direct_gallery/',
      ups: 4321,
      spoiler: true,
      is_gallery: true,
      gallery_data: { items: [{ media_id: 'a1' }, { media_id: 'b2' }] },
      media_metadata: {
        a1: {
          status: 'valid',
          s: { u: 'https://preview.redd.it/a1.jpg?format=pjpg' }
        },
        b2: {
          status: 'valid',
          s: { u: 'https://preview.redd.it/b2.png?format=png' }
        }
      }
    },
    mediaUrls: [
      'https://preview.redd.it/a1.jpg?format=pjpg',
      'https://preview.redd.it/b2.png?format=png'
    ],
    wantCaption:
      'direct gallery\n\nr/pics · <a href="https://www.reddit.com/r/pics/comments/galdirect/direct_gallery/">↑4321</a> · <a href="https://t.me/tom">@tom</a>'
  }
];

describe('direct Reddit images through gallery-dl', () => {
  test.each(
    cases
  )('preserves $kind media, captions, history and cleanup without Reddit HTTP calls', async ({
    kind,
    sourceUrl,
    post,
    mediaUrls,
    wantCaption
  }) => {
    const db = new FakeDatabaseClient();
    const calls: string[] = [];
    const execFile = vi.fn(async (file: string, args: string[]) => {
      calls.push(file);
      if (file === 'yt-dlp') throw new Error('No video formats');

      expect(file).toBe('gallery-dl');
      expect(args).toContain('--resolve-json');
      expect(args).toContain(sourceUrl);
      expect(args).toContain('/app/data/reddit-cookies.txt');

      return { stdout: JSON.stringify([[2, post]]), stderr: '' };
    });
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      expect(mediaUrls).toContain(url);

      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'Content-Length': '3' }
      });
    });
    const dispatchedPaths: string[] = [];
    const memeDispatcher = vi.fn(async (input) => {
      dispatchedPaths.push(
        ...(input.media.kind === 'gallery'
          ? input.media.items.map((item: { filePath: string }) => item.filePath)
          : [input.media.filePath])
      );

      return { messageId: 515, createdAt: '2026-10-30T12:00:00.000Z' };
    });
    const deleteMessageDispatcher = vi.fn().mockResolvedValue(undefined);
    const orchestrator = createOrchestrator({
      db,
      execFile,
      fetch: fetchMock,
      env: { sqlitePath: '/app/data/bot.sqlite' },
      qwen: { generateReply: vi.fn() },
      replyDispatcher: vi.fn(),
      memeDispatcher,
      deleteMessageDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        text: sourceUrl,
        messageId: 47,
        chatType: 'supergroup'
      })
    );

    expect(calls).toEqual(['yt-dlp', 'gallery-dl']);
    expect(fetchMock).toHaveBeenCalledTimes(mediaUrls.length);
    expect(memeDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 1,
        reply: false,
        replyToMessageId: null,
        caption: wantCaption,
        media: expect.objectContaining({ kind }),
        ...(kind === 'gallery' ? { hasSpoiler: true } : {})
      })
    );
    if (kind === 'gallery') {
      expect(memeDispatcher.mock.calls[0]?.[0].media.items).toEqual([
        expect.objectContaining({ hasSpoiler: true }),
        expect.objectContaining({ hasSpoiler: true })
      ]);
    }
    expect(deleteMessageDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      messageId: 47
    });
    expect(db.savedMemePosts[0]).toMatchObject({
      redditPostId: post.id,
      mediaKind: kind,
      mediaUrl: kind === 'gallery' ? null : mediaUrls[0]
    });
    expect(dispatchedPaths).toHaveLength(mediaUrls.length);
    expect(dispatchedPaths.every((filePath) => !existsSync(filePath))).toBe(
      true
    );
  });

  test('ignores a text-only Reddit post without deleting its source message', async () => {
    const db = new FakeDatabaseClient();
    const fetchMock = vi.fn().mockRejectedValue(new Error('HTTP must not run'));
    const execFile = vi.fn(async (file: string) => {
      if (file === 'yt-dlp') throw new Error('No video found');

      expect(file).toBe('gallery-dl');

      return {
        stdout: JSON.stringify([
          [
            2,
            {
              id: 'selfdirect',
              subreddit: 'memes',
              title: 'text only',
              permalink: '/r/memes/comments/selfdirect/text_only/',
              is_self: true,
              url: 'https://www.reddit.com/r/memes/comments/selfdirect/text_only/'
            }
          ]
        ]),
        stderr: ''
      };
    });
    const memeDispatcher = vi.fn();
    const deleteMessageDispatcher = vi.fn();
    const orchestrator = createOrchestrator({
      db,
      fetch: fetchMock,
      execFile,
      qwen: { generateReply: vi.fn() },
      replyDispatcher: vi.fn(),
      memeDispatcher,
      deleteMessageDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        text: 'https://www.reddit.com/r/memes/comments/selfdirect/text_only/'
      })
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(memeDispatcher).not.toHaveBeenCalled();
    expect(deleteMessageDispatcher).not.toHaveBeenCalled();
    expect(db.savedMemePosts).toEqual([]);
  });
});
