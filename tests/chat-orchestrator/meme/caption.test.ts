import { describe, expect, test } from 'vitest';

import { formatMemeCaption } from '../../../src/app/chat-orchestrator/meme/caption.js';

describe('formatMemeCaption', () => {
  test('escapes original title and links upvotes to the original post', () => {
    expect(
      formatMemeCaption({
        title: '<this & true>',
        subreddit: 'memes',
        upvotes: 50_592,
        permalink: 'https://redd.it/abc123',
        maxLength: 1024
      })
    ).toBe(
      '&lt;this &amp; true&gt;\n\nr/memes · <a href="https://redd.it/abc123">↑50592</a>'
    );
  });

  test('truncates title while preserving linked metadata', () => {
    const caption = formatMemeCaption({
      title: 'very long meme title',
      subreddit: 'memes',
      upvotes: 1_234,
      permalink: 'https://redd.it/abc123',
      maxLength: 64
    });

    expect(caption).toBe(
      'very long…\n\nr/memes · <a href="https://redd.it/abc123">↑1234</a>'
    );
  });

  test('does not truncate inside escaped HTML entities', () => {
    const caption = formatMemeCaption({
      title: '&&&&&&',
      subreddit: 'memes',
      upvotes: 1,
      permalink: 'https://redd.it/abc123',
      maxLength: 57
    });

    expect(caption).toBe(
      '&amp;…\n\nr/memes · <a href="https://redd.it/abc123">↑1</a>'
    );
    expect(caption).not.toContain('&am…');
  });
});
