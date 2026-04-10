import { expect, test } from "vitest";

import { buildReplyContext } from "../src/app/reply-context-builder.js";
import type { StoredMessage } from "../src/domain/models.js";

class FakeDatabaseClient {
  private readonly messages = new Map<number, StoredMessage[]>();

  seedStoredMessages(chatId: number, messages: StoredMessage[]): void {
    this.messages.set(
      chatId,
      messages.map((message) => ({ ...message }))
    );
  }

  getMessageByTelegramMessageId(chatId: number, messageId: number): StoredMessage | null {
    const message = (this.messages.get(chatId) ?? []).find(
      (candidate) => candidate.messageId === messageId
    );

    return message ? { ...message } : null;
  }

  getMessagesBefore(chatId: number, beforeMessageId: number, limit: number): StoredMessage[] {
    return (this.messages.get(chatId) ?? [])
      .filter((message) => message.messageId < beforeMessageId)
      .slice(-limit)
      .map((message) => ({ ...message }));
  }
}

test("builds causal reply context for reply_to_bot without replaying the whole bot loop", () => {
  const db = new FakeDatabaseClient();

  db.seedStoredMessages(1, [
    {
      messageId: 98,
      userId: 77,
      senderDisplayName: "Хрюпа",
      text: "старый ботовый ответ не из этого диалога",
      isBot: true,
      replyToMessageId: 97,
      createdAt: "2026-04-10T11:59:50.000Z",
      chatId: 1
    },
    {
      messageId: 100,
      userId: 42,
      senderDisplayName: "Tom",
      text: "ну чо",
      isBot: false,
      replyToMessageId: null,
      createdAt: "2026-04-10T12:00:00.000Z",
      chatId: 1
    },
    {
      messageId: 101,
      userId: 77,
      senderDisplayName: "Хрюпа",
      text: "какой-то странный ответ про кота",
      isBot: true,
      replyToMessageId: 100,
      createdAt: "2026-04-10T12:00:05.000Z",
      chatId: 1
    },
    {
      messageId: 102,
      userId: 126,
      senderDisplayName: "Хачик",
      text: "почему кот",
      isBot: false,
      replyToMessageId: 101,
      createdAt: "2026-04-10T12:00:10.000Z",
      chatId: 1
    }
  ]);

  const context = buildReplyContext({
    db,
    chatId: 1,
    triggerMessageId: 102,
    reason: "reply_to_bot",
    messageContextLimit: 16
  });

  expect(context.triggerMessage?.messageId).toBe(102);
  expect(context.anchorBotMessage?.messageId).toBe(101);
  expect(context.anchorParentMessage?.messageId).toBe(100);
  expect(context.transcriptMessages.map((message) => message.messageId)).toEqual([100, 101, 102]);
});

test("falls back to a recent window for non-reply triggers", () => {
  const db = new FakeDatabaseClient();

  db.seedStoredMessages(1, [
    {
      messageId: 99,
      userId: 77,
      senderDisplayName: "Хрюпа",
      text: "раньше",
      isBot: false,
      replyToMessageId: null,
      createdAt: "2026-04-10T11:59:55.000Z",
      chatId: 1
    },
    {
      messageId: 100,
      userId: 42,
      senderDisplayName: "Tom",
      text: "ну чо",
      isBot: false,
      replyToMessageId: null,
      createdAt: "2026-04-10T12:00:00.000Z",
      chatId: 1
    },
    {
      messageId: 102,
      userId: 126,
      senderDisplayName: "Хачик",
      text: "почему кот",
      isBot: false,
      replyToMessageId: null,
      createdAt: "2026-04-10T12:00:10.000Z",
      chatId: 1
    }
  ]);

  const triggerMessageId = 102;
  const context = buildReplyContext({
    db,
    chatId: 1,
    triggerMessageId,
    reason: "mention",
    messageContextLimit: 3
  });

  expect(context.anchorBotMessage).toBeNull();
  expect(context.anchorParentMessage).toBeNull();
  expect(context.transcriptMessages.map((message) => message.messageId)).toEqual([99, 100, 102]);
});

test("keeps reply_to_bot causal when the anchor bot parent message is missing", () => {
  const db = new FakeDatabaseClient();

  db.seedStoredMessages(1, [
    {
      messageId: 97,
      userId: 55,
      senderDisplayName: "Лена",
      text: "старый левый разговор",
      isBot: false,
      replyToMessageId: null,
      createdAt: "2026-04-10T11:59:40.000Z",
      chatId: 1
    },
    {
      messageId: 98,
      userId: 77,
      senderDisplayName: "Хрюпа",
      text: "старый ботовый ответ не по теме",
      isBot: true,
      replyToMessageId: 97,
      createdAt: "2026-04-10T11:59:45.000Z",
      chatId: 1
    },
    {
      messageId: 101,
      userId: 77,
      senderDisplayName: "Хрюпа",
      text: "какой-то странный ответ про кота",
      isBot: true,
      replyToMessageId: 100,
      createdAt: "2026-04-10T12:00:05.000Z",
      chatId: 1
    },
    {
      messageId: 102,
      userId: 126,
      senderDisplayName: "Хачик",
      text: "почему кот",
      isBot: false,
      replyToMessageId: 101,
      createdAt: "2026-04-10T12:00:10.000Z",
      chatId: 1
    }
  ]);

  const context = buildReplyContext({
    db,
    chatId: 1,
    triggerMessageId: 102,
    reason: "reply_to_bot",
    messageContextLimit: 16
  });

  expect(context.anchorBotMessage?.messageId).toBe(101);
  expect(context.anchorParentMessage).toBeNull();
  expect(context.transcriptMessages.map((message) => message.messageId)).toEqual([101, 102]);
});
