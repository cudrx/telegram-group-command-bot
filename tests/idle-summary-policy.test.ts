import { describe, expect, test } from "vitest";

import { shouldRunIdleSummary } from "../src/domain/idle-summary-policy.js";

describe("shouldRunIdleSummary", () => {
  test("returns false when chat has no messages", () => {
    expect(
      shouldRunIdleSummary({
        lastMessageAt: null,
        lastSummaryAt: null,
        unsummarizedMessageCount: 12,
        idleThresholdMs: 1_800_000,
        minMessages: 10,
        now: "2026-04-03T10:00:00.000Z"
      })
    ).toBe(false);
  });

  test("returns false when chat is not idle yet", () => {
    expect(
      shouldRunIdleSummary({
        lastMessageAt: "2026-04-03T09:45:00.000Z",
        lastSummaryAt: "2026-04-03T08:00:00.000Z",
        unsummarizedMessageCount: 12,
        idleThresholdMs: 1_800_000,
        minMessages: 10,
        now: "2026-04-03T10:00:00.000Z"
      })
    ).toBe(false);
  });

  test("returns false when there are too few unsummarized messages", () => {
    expect(
      shouldRunIdleSummary({
        lastMessageAt: "2026-04-03T09:00:00.000Z",
        lastSummaryAt: "2026-04-03T08:00:00.000Z",
        unsummarizedMessageCount: 4,
        idleThresholdMs: 1_800_000,
        minMessages: 10,
        now: "2026-04-03T10:00:00.000Z"
      })
    ).toBe(false);
  });

  test("returns true for idle chats with enough pending messages", () => {
    expect(
      shouldRunIdleSummary({
        lastMessageAt: "2026-04-03T09:00:00.000Z",
        lastSummaryAt: "2026-04-03T08:00:00.000Z",
        unsummarizedMessageCount: 12,
        idleThresholdMs: 1_800_000,
        minMessages: 10,
        now: "2026-04-03T10:00:00.000Z"
      })
    ).toBe(true);
  });
});
