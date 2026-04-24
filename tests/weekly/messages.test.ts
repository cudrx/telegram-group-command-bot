import { describe, expect, test } from 'vitest';
import { loadWeeklyMessages } from '../../src/app/weekly/messages.js';
import { FakeDatabaseClient } from '../chat-orchestrator/support/fake-database.js';
import {
  canUseBetterSqlite,
  createDatabase,
  createIncomingMessage
} from '../database/support.js';

const describeWithSqlite = canUseBetterSqlite() ? describe : describe.skip;

describeWithSqlite('weekly message database reads', () => {
  test('loads messages in created_at range ordered by telegram message id', () => {
    const db = createDatabase();

    for (const message of [
      { messageId: 10, createdAt: '2026-04-16T09:00:00.000Z' },
      { messageId: 12, createdAt: '2026-04-24T08:59:59.000Z' },
      { messageId: 11, createdAt: '2026-04-17T09:00:00.000Z' },
      { messageId: 13, createdAt: '2026-04-24T09:00:00.000Z' }
    ]) {
      db.saveIncomingMessage(createIncomingMessage(message));
    }

    expect(
      db
        .getMessagesInRange({
          chatId: 1,
          fromInclusive: '2026-04-17T00:00:00.000Z',
          toExclusive: '2026-04-24T09:00:00.000Z'
        })
        .map((message) => message.messageId)
    ).toEqual([11, 12]);
  });
});

describe('weekly fake database reads', () => {
  test('supports weekly range reads', () => {
    const db = new FakeDatabaseClient();

    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        createdAt: '2026-04-20T10:00:00.000Z'
      })
    );
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        createdAt: '2026-04-21T10:00:00.000Z'
      })
    );

    expect(
      db.getMessagesInRange({
        chatId: 1,
        fromInclusive: '2026-04-21T00:00:00.000Z',
        toExclusive: '2026-04-22T00:00:00.000Z'
      })
    ).toHaveLength(1);
  });
});

describe('weekly message loading', () => {
  test('filters bot messages and requests the previous seven days', () => {
    const calls: Array<{
      chatId: number;
      fromInclusive: string;
      toExclusive: string;
    }> = [];
    const db = {
      getMessagesInRange(input: {
        chatId: number;
        fromInclusive: string;
        toExclusive: string;
      }) {
        calls.push(input);

        return [
          {
            chatId: 1,
            messageId: 1,
            mediaGroupId: null,
            userId: 42,
            senderDisplayName: 'Tom',
            text: 'human',
            createdAt: '2026-04-20T12:00:00.000Z',
            isBot: false,
            replyToMessageId: null,
            mediaSnapshot: null
          },
          {
            chatId: 1,
            messageId: 2,
            mediaGroupId: null,
            userId: 77,
            senderDisplayName: 'Bot',
            text: 'bot',
            createdAt: '2026-04-20T12:01:00.000Z',
            isBot: true,
            replyToMessageId: null,
            mediaSnapshot: null
          }
        ];
      }
    };

    const messages = loadWeeklyMessages({
      db,
      chatId: 1,
      now: '2026-04-24T09:00:00.000Z'
    });

    expect(calls).toEqual([
      {
        chatId: 1,
        fromInclusive: '2026-04-17T09:00:00.000Z',
        toExclusive: '2026-04-24T09:00:00.000Z'
      }
    ]);
    expect(messages).toEqual([
      expect.objectContaining({
        messageId: 1,
        mediaSummary: null
      })
    ]);
  });
});
