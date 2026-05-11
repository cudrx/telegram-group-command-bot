import { describe, expect, test } from 'vitest';

import { formatMemeCaption } from '../../../src/app/chat-orchestrator/meme/caption.js';

describe('formatMemeCaption', () => {
  test('escapes localized text and appends source metadata', () => {
    expect(
      formatMemeCaption({
        localizedTitle: '<это & правда>',
        subreddit: 'memes',
        upvotes: 50_592,
        maxLength: 1024
      })
    ).toBe('&lt;это &amp; правда&gt;\n\nr/memes · 50 592 апвоутов');
  });

  test('truncates localized text while preserving metadata', () => {
    const caption = formatMemeCaption({
      localizedTitle: 'очень длинный заголовок',
      subreddit: 'memes',
      upvotes: 1,
      maxLength: 35
    });

    expect(caption).toBe('очень длинны…\n\nr/memes · 1 апвоутов');
  });

  test('does not truncate inside escaped HTML entities', () => {
    const caption = formatMemeCaption({
      localizedTitle: '&&&&&&',
      subreddit: 'memes',
      upvotes: 1,
      maxLength: 31
    });

    expect(caption).toBe('&amp;…\n\nr/memes · 1 апвоутов');
    expect(caption).not.toContain('&am…');
  });
});
