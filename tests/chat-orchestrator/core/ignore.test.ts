import { describe, expect, test, vi } from 'vitest';

import {
  createIncomingMessage,
  createOrchestrator,
  createReplyResult,
  FakeDatabaseClient
} from '../support.js';

describe('ChatOrchestrator ignore paths', () => {
  test('ignores ordinary messages and does not call the LLM', async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('не надо'));
    const replyDispatcher = vi.fn();
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({ text: 'обычно болтаем' })
    );

    expect(generateReply).not.toHaveBeenCalled();
    expect(replyDispatcher).not.toHaveBeenCalled();
  });

  test('ignores ordinary mentions and does not call the LLM', async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('не надо'));
    const replyDispatcher = vi.fn();
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        text: '@fun_bot кто прав?',
        entities: [{ type: 'mention', offset: 0, length: 8 }]
      })
    );

    expect(generateReply).not.toHaveBeenCalled();
    expect(replyDispatcher).not.toHaveBeenCalled();
  });

  test('ignores unsupported commands through action resolution', async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('не надо'));
    const replyDispatcher = vi.fn();
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        text: '/unknown',
        entities: [{ type: 'bot_command', offset: 0, length: 8 }]
      })
    );

    expect(generateReply).not.toHaveBeenCalled();
    expect(replyDispatcher).not.toHaveBeenCalled();
  });

  test('ignores commands from private link-only users', async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('не надо'));
    const replyDispatcher = vi.fn();
    const fetchMock = vi.fn();
    const memeDispatcher = vi.fn();
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher,
      fetch: fetchMock,
      memeDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        authorizedMode: 'private_link_sender',
        chatType: 'private',
        text: '/meme',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }]
      })
    );

    expect(generateReply).not.toHaveBeenCalled();
    expect(replyDispatcher).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(memeDispatcher).not.toHaveBeenCalled();
  });

  test('ignores commands with supported URLs from private link-only users', async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('не надо'));
    const replyDispatcher = vi.fn();
    const fetchMock = vi.fn();
    const memeDispatcher = vi.fn();
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher,
      fetch: fetchMock,
      memeDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        authorizedMode: 'private_link_sender',
        chatType: 'private',
        text: '/meme https://www.reddit.com/r/SipsTea/comments/1ti5fvt/title/',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }]
      })
    );

    expect(generateReply).not.toHaveBeenCalled();
    expect(replyDispatcher).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(memeDispatcher).not.toHaveBeenCalled();
  });
});
