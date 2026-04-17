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

test("builds mention-only reply context from the current message and recent human context", () => {
  const db = new FakeDatabaseClient();

  db.seedStoredMessages(1, [
    {
      messageId: 98,
      userId: 77,
      senderDisplayName: "Bot",
      text: "старый бот",
      isBot: true,
      replyToMessageId: 97,
      createdAt: "2026-04-10T11:59:50.000Z",
      chatId: 1
    },
    {
      messageId: 99,
      userId: 42,
      senderDisplayName: "Tom",
      text: "первый человек",
      isBot: false,
      replyToMessageId: null,
      createdAt: "2026-04-10T11:59:55.000Z",
      chatId: 1
    },
    {
      messageId: 100,
      userId: 42,
      senderDisplayName: "Tom",
      text: "@fun_bot что думаешь",
      isBot: false,
      replyToMessageId: null,
      createdAt: "2026-04-10T12:00:00.000Z",
      chatId: 1
    },
    {
      messageId: 101,
      userId: 77,
      senderDisplayName: "Bot",
      text: "ботовый шум",
      isBot: true,
      replyToMessageId: 100,
      createdAt: "2026-04-10T12:00:05.000Z",
      chatId: 1
    },
    {
      messageId: 102,
      userId: 126,
      senderDisplayName: "Хачик",
      text: "второй человек",
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
    messageContextLimit: 3
  });

  expect(context.triggerMessage?.messageId).toBe(102);
  expect(context.priorContextMessages.map((message) => message.messageId)).toEqual([99, 100]);
  expect(context.priorContextMessages.every((message) => !message.isBot)).toBe(true);
  expect("anchorBotMessage" in context).toBe(false);
  expect("anchorParentMessage" in context).toBe(false);
});

test("returns an empty reply context when the trigger message is missing", () => {
  const db = new FakeDatabaseClient();

  const context = buildReplyContext({
    db,
    chatId: 1,
    triggerMessageId: 102,
    messageContextLimit: 3
  });

  expect(context).toEqual({
    triggerMessage: null,
    priorContextMessages: []
  });
});
