import { describe, expect, test } from 'vitest';

import { detectDirectMediaLink } from '../../src/app/chat-orchestrator/direct-media-link.js';

describe('detectDirectMediaLink', () => {
  test('detects Reddit post and share links', () => {
    expect(
      detectDirectMediaLink(
        'https://www.reddit.com/r/SipsTea/comments/1ti5fvt/title/'
      )
    ).toEqual({ kind: 'reddit' });
    expect(
      detectDirectMediaLink('https://www.reddit.com/r/SipsTea/s/abc123')
    ).toEqual({ kind: 'reddit' });
  });

  test('detects Instagram Reel links', () => {
    expect(
      detectDirectMediaLink(
        'https://www.instagram.com/reel/DYKAmhRu8g-/?igsh=abc'
      )
    ).toEqual({ kind: 'instagram_reel' });
  });

  test('ignores ordinary text and unsupported links', () => {
    expect(detectDirectMediaLink('обычно болтаем')).toBeNull();
    expect(detectDirectMediaLink('https://example.com/video')).toBeNull();
    expect(
      detectDirectMediaLink('https://www.instagram.com/bookstasyaa/')
    ).toBeNull();
  });
});
