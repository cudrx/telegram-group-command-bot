import { describe, expect, test } from 'vitest';

import { appendDirectMediaAuthor } from '../../src/app/chat-orchestrator/direct-media-author.js';

describe('appendDirectMediaAuthor', () => {
  test('adds a linked username in group chats', () => {
    expect(
      appendDirectMediaAuthor('tt: creator · likes: 10', {
        chatType: 'group',
        fromUserId: 42,
        fromUsername: 'tg_nick',
        fromDisplayName: 'Tom'
      })
    ).toBe(
      'tt: creator · likes: 10 · <a href="https://t.me/tg_nick">@tg_nick</a>'
    );
  });

  test('falls back to an escaped display name linked by user id', () => {
    expect(
      appendDirectMediaAuthor('tt: creator · likes: 10', {
        chatType: 'supergroup',
        fromUserId: 42,
        fromUsername: null,
        fromDisplayName: '<Tom & Jerry>'
      })
    ).toBe(
      'tt: creator · likes: 10 · <a href="tg://user?id=42">&lt;Tom &amp; Jerry&gt;</a>'
    );
  });

  test('uses plain escaped display name when no user id is available', () => {
    expect(
      appendDirectMediaAuthor('tt: creator · likes: 10', {
        chatType: 'group',
        fromUserId: null,
        fromUsername: null,
        fromDisplayName: 'Anonymous & Admin'
      })
    ).toBe('tt: creator · likes: 10 · Anonymous &amp; Admin');
  });

  test('does not add an author in private chats', () => {
    expect(
      appendDirectMediaAuthor('tt: creator · likes: 10', {
        chatType: 'private',
        fromUserId: 42,
        fromUsername: 'tg_nick',
        fromDisplayName: 'Tom'
      })
    ).toBe('tt: creator · likes: 10');
  });
});
