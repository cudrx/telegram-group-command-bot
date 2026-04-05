import { describe, expect, test } from "vitest";

import { ChatJobCoordinator } from "../src/app/chat-job-coordinator.js";

describe("ChatJobCoordinator", () => {
  test("blocks overlapping jobs in the same chat and allows different chats", () => {
    const coordinator = new ChatJobCoordinator();

    expect(coordinator.start(1, "replying")).toBe(true);
    expect(coordinator.start(1, "summarizing")).toBe(false);
    expect(coordinator.start(2, "summarizing")).toBe(true);
  });

  test("prefers the most important queued reply and returns it first", () => {
    const coordinator = new ChatJobCoordinator();

    coordinator.start(1, "replying");
    coordinator.queueReply({
      chatId: 1,
      chatType: "group",
      chatTitle: "Friends",
      replyToMessageId: 10,
      fromUserId: 42,
      fromDisplayName: "Tom",
      createdAt: "2026-04-03T12:00:00.000Z",
      reason: "interjection"
    });
    coordinator.queueReply({
      chatId: 1,
      chatType: "group",
      chatTitle: "Friends",
      replyToMessageId: 11,
      fromUserId: 42,
      fromDisplayName: "Tom",
      createdAt: "2026-04-03T12:01:00.000Z",
      reason: "mention"
    });

    coordinator.finish(1, "replying");

    expect(coordinator.takeNext(1)).toEqual({
      type: "reply",
      request: {
        chatId: 1,
        chatType: "group",
        chatTitle: "Friends",
        replyToMessageId: 11,
        fromUserId: 42,
        fromDisplayName: "Tom",
        createdAt: "2026-04-03T12:01:00.000Z",
        reason: "mention"
      }
    });
    expect(coordinator.getPhase(1)).toBeNull();
  });
});
