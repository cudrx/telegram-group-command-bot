import { afterEach, describe, expect, test, vi } from 'vitest';

import { ChatOrchestrator } from '../../src/app/chat-orchestrator/index.js';
import type { ChatOrchestratorDeps } from '../../src/app/chat-orchestrator/types.js';
import {
  type SpontaneousPolicy,
  spontaneousConfig
} from '../../src/config/runtime/spontaneous.js';
import { DatabaseClient } from '../../src/database/index.js';
import type { GenerateSpontaneousResult } from '../../src/llm/openai-compatible-client/index.js';
import {
  canUseBetterSqlite,
  createIncomingMessage
} from '../database/support.js';
import { createTestChatPolicy } from '../helpers/telegram-fixtures.js';
import { createEnv, createLogger } from './support.js';

const databases: DatabaseClient[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
const describeWithSqlite = canUseBetterSqlite() ? describe : describe.skip;

function setup(overrides: Partial<SpontaneousPolicy> = {}) {
  const db = DatabaseClient.open(':memory:');
  databases.push(db);
  let now = Date.parse('2026-11-08T12:00:00.000Z');
  let seed = 123;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const policy = createTestChatPolicy({
    chatId: 1,
    spontaneous: {
      ...spontaneousConfig.defaults,
      enabled: true,
      probability: 1,
      ...overrides
    }
  });
  const result: GenerateSpontaneousResult = {
    decision: { action: 'send', text: 'сервер варит прод <script> & суп' },
    validOutput: true,
    model: 'test',
    latencyMs: 1,
    attemptCount: 1,
    promptTokensEstimate: 20
  };
  const generateSpontaneous = vi.fn().mockResolvedValue(result);
  const generateReply = vi.fn();
  const generateAnswer = vi.fn();
  const replyDispatcher = vi.fn().mockImplementation(async () => ({
    messageId: 200,
    createdAt: new Date(now).toISOString()
  }));
  const deps: ChatOrchestratorDeps = {
    db,
    qwen: { generateSpontaneous, generateReply, generateAnswer },
    env: createEnv(),
    lookupProvider: null,
    bot: { userId: 77, username: 'fun_bot', displayName: 'Пруфик' },
    replyDispatcher,
    voiceDispatcher: vi.fn(),
    memeDispatcher: vi.fn(),
    editMessageTextDispatcher: vi.fn(),
    deleteMessageDispatcher: vi.fn(),
    sendChatAction: vi.fn(),
    delay: vi.fn(),
    logger: createLogger(),
    now: () => new Date(now).toISOString(),
    random
  };
  const orchestrator = new ChatOrchestrator(deps);
  const message = (messageId = 100, text = 'прод опять греет сервер') =>
    createIncomingMessage({
      chatId: 1,
      messageId,
      text,
      createdAt: deps.now(),
      accessContext: { kind: 'configured_chat', policy }
    });
  const seedChat = (chatId = 1, count = 24) => {
    for (let id = 1; id <= count; id++)
      db.saveIncomingMessage(
        createIncomingMessage({
          chatId,
          messageId: id,
          text: `${id % 2 ? 'наш сервер танцует' : 'твой сервер грустит'} ${id}`,
          createdAt: new Date(now - 300000 + id * 1000).toISOString()
        })
      );
  };

  return {
    db,
    deps,
    orchestrator,
    policy,
    result,
    generateSpontaneous,
    generateReply,
    generateAnswer,
    replyDispatcher,
    message,
    seedChat,
    advance: (ms: number) => {
      now += ms;
    }
  };
}

describeWithSqlite('spontaneous messages through the orchestrator', () => {
  test('uses only same-chat humans for a draft, adapts once, and persists the labeled sent reply', async () => {
    const h = setup();
    h.seedChat();
    h.seedChat(2);
    h.db.saveIncomingMessage(
      createIncomingMessage({
        chatId: 2,
        messageId: 50,
        text: 'чужой секретный огурец'
      })
    );
    h.db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 50,
        text: 'ботовый уникальный термин',
        isBot: true
      })
    );
    await h.orchestrator.handleIncomingMessage(h.message());
    expect(h.generateSpontaneous).toHaveBeenCalledTimes(1);
    expect(h.generateReply).not.toHaveBeenCalled();
    expect(h.generateAnswer).not.toHaveBeenCalled();
    const input = h.generateSpontaneous.mock.calls[0]?.[0];
    expect(input.draft).not.toMatch(/секретный|ботовый/);
    expect(
      input.messages.every((item: { chatId: number }) => item.chatId === 1)
    ).toBe(true);
    expect(input.messages.at(-1).text).toBe('прод опять греет сервер');
    expect(h.replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      reply: false,
      text: 'сервер варит прод  &amp; суп'
    });
    expect(h.db.getMessageByTelegramMessageId(1, 200)).toMatchObject({
      isBot: true,
      generationKind: 'spontaneous_markov_llm',
      replyToMessageId: null,
      text: h.result.decision.action === 'send' ? h.result.decision.text : ''
    });
  });

  test.each([
    'disabled',
    'private',
    'bot',
    'command',
    'mention',
    'reply',
    'link',
    'stale',
    'probability',
    'cold'
  ])('does not call the adapter for %s messages', async (kind) => {
    const h = setup();
    h.seedChat();
    const message = h.message();
    if (kind === 'disabled' && h.policy.spontaneous)
      h.policy.spontaneous.enabled = false;
    if (kind === 'private') {
      message.chatType = 'private';
      message.accessContext = { kind: 'private_admin' };
    }
    if (kind === 'bot') message.isBot = true;
    if (kind === 'command') {
      message.text = '/unknown';
      message.entities = [{ type: 'bot_command', offset: 0, length: 8 }];
    }
    if (kind === 'mention') {
      message.text = '@fun_bot привет';
      message.entities = [{ type: 'mention', offset: 0, length: 8 }];
      h.policy.features.assistant = false;
    }
    if (kind === 'reply') {
      message.replyToUserId = 77;
      h.policy.features.assistant = false;
    }
    if (kind === 'link') {
      message.text = 'https://youtu.be/abc';
      h.policy.features.direct_links = false;
    }
    if (kind === 'stale') message.createdAt = '2026-11-07T12:00:00.000Z';
    if (kind === 'probability') h.deps.random = () => 1;
    if (kind === 'cold') {
      message.chatId = 3;
      message.accessContext = {
        kind: 'configured_chat',
        policy: { ...h.policy, chatId: 3 }
      };
    }
    await h.orchestrator.handleIncomingMessage(message);
    expect(h.generateSpontaneous).not.toHaveBeenCalled();
  });

  test('duplicates never trigger a second attempt', async () => {
    const h = setup();
    h.seedChat();
    await h.orchestrator.handleIncomingMessage(h.message());
    h.advance(3600000);
    await h.orchestrator.handleIncomingMessage(h.message());
    expect(h.generateSpontaneous).toHaveBeenCalledTimes(1);
  });

  test('skip consumes cooldown and message gap, including after recreating the orchestrator', async () => {
    const h = setup({ minMessages: 2 });
    h.seedChat();
    h.generateSpontaneous.mockResolvedValue({
      ...h.result,
      decision: { action: 'skip' }
    });
    await h.orchestrator.handleIncomingMessage(h.message());
    const restarted = new ChatOrchestrator(h.deps);
    await restarted.handleIncomingMessage(h.message(101));
    h.advance(900000);
    await restarted.handleIncomingMessage(h.message(102));
    expect(h.generateSpontaneous).toHaveBeenCalledTimes(2);
    expect(h.replyDispatcher).not.toHaveBeenCalled();
  });

  test('hourly attempt cap includes skips and becomes available after the rolling window', async () => {
    const h = setup({
      cooldownSeconds: 1,
      minMessages: 1,
      maxAttemptsPerHour: 2
    });
    h.seedChat();
    h.generateSpontaneous.mockResolvedValue({
      ...h.result,
      decision: { action: 'skip' }
    });
    for (let id = 100; id <= 103; id++) {
      await h.orchestrator.handleIncomingMessage(h.message(id));
      h.advance(2000);
    }
    expect(h.generateSpontaneous).toHaveBeenCalledTimes(2);
    h.advance(3600000);
    await h.orchestrator.handleIncomingMessage(h.message(104));
    expect(h.generateSpontaneous).toHaveBeenCalledTimes(3);
  });

  test('provider failure stays silent and consumes the attempt budget', async () => {
    const h = setup();
    h.seedChat();
    h.generateSpontaneous.mockRejectedValue(new Error('provider failed'));
    await h.orchestrator.handleIncomingMessage(h.message());
    await new ChatOrchestrator(h.deps).handleIncomingMessage(h.message(101));
    expect(h.generateSpontaneous).toHaveBeenCalledTimes(1);
    expect(h.replyDispatcher).not.toHaveBeenCalled();
  });

  test('keeps a previous labeled joke in the adapter context but never trains on it', async () => {
    const h = setup();
    h.seedChat();
    h.db.saveBotMessage({
      chatId: 1,
      chatType: 'group',
      chatTitle: 'test',
      messageId: 50,
      userId: 77,
      username: 'fun_bot',
      displayName: 'Пруфик',
      text: 'космический сверхпельмень',
      createdAt: '2026-11-08T11:58:00Z',
      generationKind: 'spontaneous_markov_llm'
    });
    await h.orchestrator.handleIncomingMessage(h.message());
    const input = h.generateSpontaneous.mock.calls[0]?.[0];
    expect(
      input.messages.find(
        (item: { messageId: number }) => item.messageId === 50
      )?.generationKind
    ).toBe('spontaneous_markov_llm');
    expect(input.draft).not.toContain('сверхпельмень');
  });

  test('only one adapter call can be in flight per chat', async () => {
    const h = setup({ minMessages: 1, cooldownSeconds: 1 });
    h.seedChat();
    let finish!: (result: GenerateSpontaneousResult) => void;
    h.generateSpontaneous.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const pending = h.orchestrator.handleIncomingMessage(h.message());
    h.advance(2000);
    await h.orchestrator.handleIncomingMessage(h.message(101));
    expect(h.generateSpontaneous).toHaveBeenCalledTimes(1);
    finish(h.result);
    await pending;
    expect(h.replyDispatcher).not.toHaveBeenCalled();
  });

  test('a foreground command cancels a pending spontaneous send', async () => {
    const h = setup();
    h.seedChat();
    let finish!: (result: GenerateSpontaneousResult) => void;
    h.generateSpontaneous.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const pending = h.orchestrator.handleIncomingMessage(h.message());
    const command = h.message(101, '/translate');
    command.entities = [{ type: 'bot_command', offset: 0, length: 10 }];
    await h.orchestrator.handleIncomingMessage(command);
    h.replyDispatcher.mockClear();
    finish(h.result);
    await pending;
    expect(h.replyDispatcher).not.toHaveBeenCalled();
  });

  test('media without a caption does not hide earlier conversational context', async () => {
    const h = setup();
    h.seedChat();
    h.db.saveIncomingMessage(
      createIncomingMessage({ messageId: 60, text: 'контекст до картинки' })
    );
    h.db.saveIncomingMessage(
      createIncomingMessage({ messageId: 61, text: '' })
    );
    await h.orchestrator.handleIncomingMessage(h.message());
    expect(
      h.generateSpontaneous.mock.calls[0]?.[0].messages.some(
        (item: { text: string }) => item.text === 'контекст до картинки'
      )
    ).toBe(true);
  });

  test('an intervening human message suppresses an adaptation of an older context', async () => {
    const h = setup();
    h.seedChat();
    let finish!: (result: GenerateSpontaneousResult) => void;
    h.generateSpontaneous.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const pending = h.orchestrator.handleIncomingMessage(h.message());
    await h.orchestrator.handleIncomingMessage(
      h.message(101, 'погодите, случилась беда')
    );
    finish(h.result);
    await pending;
    expect(h.replyDispatcher).not.toHaveBeenCalled();
    expect(h.generateSpontaneous).toHaveBeenCalledTimes(1);
  });

  test('marks clipped context and bounds the text budget', async () => {
    const h = setup();
    h.seedChat();
    for (let id = 60; id < 72; id++)
      h.db.saveIncomingMessage(
        createIncomingMessage({
          messageId: id,
          text: 'важные детали '.repeat(200)
        })
      );
    await h.orchestrator.handleIncomingMessage(h.message());
    const messages = h.generateSpontaneous.mock.calls[0]?.[0]
      .messages as Array<{ text: string }>;
    expect(
      messages.reduce((sum, item) => sum + item.text.length, 0)
    ).toBeLessThanOrEqual(8000);
    expect(
      messages.some((item) => item.text.includes('[message text truncated]'))
    ).toBe(true);
  });

  test('an edited trigger suppresses an already pending adaptation', async () => {
    const h = setup();
    h.seedChat();
    let finish!: (result: GenerateSpontaneousResult) => void;
    h.generateSpontaneous.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const pending = h.orchestrator.handleIncomingMessage(h.message());
    h.db.updateIncomingMessageEdit({
      chatId: 1,
      messageId: 100,
      text: 'уже другая тема',
      editedAt: h.deps.now()
    });
    finish(h.result);
    await pending;
    expect(h.replyDispatcher).not.toHaveBeenCalled();
  });

  test('a recent ordinary bot response prevents another unsolicited interjection', async () => {
    const h = setup();
    h.seedChat();
    h.db.saveBotMessage({
      chatId: 1,
      chatType: 'group',
      chatTitle: 'test',
      messageId: 50,
      userId: 77,
      username: 'fun_bot',
      displayName: 'Пруфик',
      text: 'обычный ответ',
      createdAt: h.deps.now()
    });
    await h.orchestrator.handleIncomingMessage(h.message());
    expect(h.generateSpontaneous).not.toHaveBeenCalled();
  });

  test('failed Telegram delivery never saves a message or retries immediately', async () => {
    const h = setup();
    h.seedChat();
    h.replyDispatcher.mockRejectedValue(new Error('Telegram failed'));
    await h.orchestrator.handleIncomingMessage(h.message());
    await h.orchestrator.handleIncomingMessage(h.message(101));
    expect(h.generateSpontaneous).toHaveBeenCalledTimes(1);
    expect(h.replyDispatcher).toHaveBeenCalledTimes(1);
    expect(h.db.getMessageByTelegramMessageId(1, 200)).toBeNull();
  });

  test('attempt budgets are isolated between configured chats', async () => {
    const h = setup();
    h.seedChat();
    h.seedChat(2);
    h.generateSpontaneous.mockResolvedValue({
      ...h.result,
      decision: { action: 'skip' }
    });
    await h.orchestrator.handleIncomingMessage(h.message());
    const other = h.message();
    other.chatId = 2;
    other.accessContext = {
      kind: 'configured_chat',
      policy: { ...h.policy, chatId: 2 }
    };
    await h.orchestrator.handleIncomingMessage(other);
    expect(h.generateSpontaneous).toHaveBeenCalledTimes(2);
  });
});
