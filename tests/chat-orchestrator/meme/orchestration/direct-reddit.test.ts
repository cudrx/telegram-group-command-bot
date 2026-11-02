import { existsSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import { createVideoJobQueue } from '../../../../src/app/video-job-queue.js';
import type { MediaExecFile } from '../../../../src/media/exec.js';
import { createIncomingMessage } from '../../../database/support.js';
import { FakeDatabaseClient } from '../../support/fake-database.js';
import { createLogger } from '../../support/logger.js';
import { createOrchestrator } from '../../support/orchestrator.js';
import { writeRedditPostDump } from './support.js';

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

describe('direct Reddit media from saved yt-dlp responses', () => {
  test.each(
    cases
  )('sends $kind from saved Reddit JSON when yt-dlp rejects non-video media', async ({
    kind,
    sourceUrl,
    post,
    mediaUrls,
    wantCaption
  }) => {
    const db = new FakeDatabaseClient();
    const logger = createLogger();
    const directories: string[] = [];
    const execFile = vi.fn<MediaExecFile>(async (file, args, options) => {
      expect(file).toBe('yt-dlp');
      expect(args).toContain('--write-pages');
      if (options?.cwd) directories.push(options.cwd);
      await writeRedditPostDump(options?.cwd, {
        spoiler: false,
        over_18: false,
        ...post
      });
      throw new Error(
        'Unsupported URL: https://www.reddit.com/media?url=image'
      );
    });
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      expect(mediaUrls).toContain(url);
      return new Response(new Uint8Array([1, 2, 3]));
    });
    const paths: string[] = [];
    const memeDispatcher = vi.fn(async (input) => {
      paths.push(
        ...(input.media.kind === 'gallery'
          ? input.media.items.map((item: { filePath: string }) => item.filePath)
          : [input.media.filePath])
      );
      expect(paths.every(existsSync)).toBe(true);
      return { messageId: 515, createdAt: '2026-11-02T18:09:00.000Z' };
    });
    const deleteMessageDispatcher = vi.fn().mockResolvedValue(undefined);
    const orchestrator = createOrchestrator({
      db,
      logger,
      execFile,
      fetch: fetchMock,
      videoJobQueue: createVideoJobQueue({
        maxConcurrentJobs: 2,
        maxConcurrentJobsPerChat: 1,
        logger
      }),
      qwen: { generateReply: vi.fn() },
      replyDispatcher: vi.fn().mockResolvedValue({
        messageId: 516,
        createdAt: '2026-11-02T18:09:00.000Z'
      }),
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

    expect(execFile).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(mediaUrls);
    expect(memeDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        caption: wantCaption,
        reply: false,
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
    expect(db.savedMemePosts[0]).toMatchObject({
      redditPostId: post.id,
      mediaKind: kind
    });
    expect(deleteMessageDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      messageId: 47
    });
    expect(paths).toHaveLength(mediaUrls.length);
    expect([...paths, ...directories].every((p) => !existsSync(p))).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test('ignores a text-only Reddit post without deleting its source message', async () => {
    const db = new FakeDatabaseClient();
    const fetchMock = vi.fn().mockRejectedValue(new Error('HTTP must not run'));
    const execFile = vi.fn<MediaExecFile>(async (_file, _args, options) => {
      await writeRedditPostDump(options?.cwd, {
        id: 'selfdirect',
        subreddit: 'memes',
        title: 'text only',
        permalink: '/r/memes/comments/selfdirect/text_only/',
        is_self: true,
        spoiler: false,
        over_18: false,
        url: 'https://www.reddit.com/r/memes/comments/selfdirect/text_only/'
      });
      throw new Error('No video found');
    });
    const memeDispatcher = vi.fn();
    const deleteMessageDispatcher = vi.fn();
    const orchestrator = createOrchestrator({
      db,
      fetch: fetchMock,
      execFile,
      qwen: { generateReply: vi.fn() },
      replyDispatcher: vi.fn().mockResolvedValue({
        messageId: 516,
        createdAt: '2026-11-02T18:09:00.000Z'
      }),
      memeDispatcher,
      deleteMessageDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        text: 'https://www.reddit.com/r/memes/comments/selfdirect/text_only/',
        messageId: 47
      })
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(memeDispatcher).not.toHaveBeenCalled();
    expect(deleteMessageDispatcher).not.toHaveBeenCalledWith({
      chatId: 1,
      messageId: 47
    });
    expect(db.savedMemePosts).toEqual([]);
  });
});
