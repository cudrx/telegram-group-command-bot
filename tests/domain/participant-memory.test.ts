import { describe, expect, test } from "vitest";

import {
  buildParticipantMemoryDigest,
  getParticipantMemoryExpiresAt,
  normalizeParticipantMemoryKey,
  normalizeParticipantMemoryValue,
  pickMoreStableMemoryStability,
  pickStrongerMemorySource,
  shouldRejectParticipantMemoryUpdate
} from "../../src/domain/participant-memory.js";
import type { ParticipantMemory } from "../../src/domain/models.js";

describe("participant-memory", () => {
  test("normalizes keys and values into a stable storage form", () => {
    expect(normalizeParticipantMemoryKey(" Favorite Club ")).toBe("favorite_club");
    expect(normalizeParticipantMemoryValue("  New   Black   Cap  ")).toBe(
      "new black cap"
    );
  });

  test("rejects inferred sensitive memories", () => {
    expect(
      shouldRejectParticipantMemoryUpdate({
        userId: 42,
        category: "identity",
        key: "ethnicity",
        valueText: "армянин",
        stability: "core",
        sourceKind: "inferred",
        confidence: 0.92,
        cardinality: "single"
      })
    ).toBe(true);
  });

  test("allows explicit sensitive memories when the participant stated them", () => {
    expect(
      shouldRejectParticipantMemoryUpdate({
        userId: 42,
        category: "identity",
        key: "nationality",
        valueText: "армянин",
        stability: "core",
        sourceKind: "explicit",
        confidence: 0.92,
        cardinality: "single"
      })
    ).toBe(false);
  });

  test("gives volatile memories a TTL and keeps durable/core memories without expiry", () => {
    expect(getParticipantMemoryExpiresAt("core", "2026-04-03T12:00:00.000Z")).toBeNull();
    expect(
      getParticipantMemoryExpiresAt("volatile", "2026-04-03T12:00:00.000Z")
    ).toBe("2026-04-24T12:00:00.000Z");
  });

  test("prefers stronger source kinds and more stable memory classes", () => {
    expect(pickStrongerMemorySource("observed", "explicit")).toBe("explicit");
    expect(pickMoreStableMemoryStability("volatile", "durable")).toBe("durable");
  });

  test("builds context digest with core memories before temporary ones", () => {
    const digest = buildParticipantMemoryDigest(
      [
        createMemory({
          key: "headwear",
          valueText: "новая черная кепка",
          stability: "volatile",
          confidence: 0.75
        }),
        createMemory({
          key: "height",
          valueText: "высокий",
          stability: "core",
          confidence: 0.85
        }),
        createMemory({
          key: "favorite_club",
          valueText: "Ливерпуль",
          stability: "durable",
          confidence: 0.92
        })
      ],
      "2026-04-03T12:00:00.000Z"
    );

    expect(digest).toBe(
      "[core] height: высокий; [durable] favorite_club: Ливерпуль; [volatile] headwear: новая черная кепка"
    );
  });
});

function createMemory(input: {
  key: string;
  valueText: string;
  stability: ParticipantMemory["stability"];
  confidence: number;
}): ParticipantMemory {
  return {
    memoryId: 1,
    chatId: 1,
    userId: 42,
    category: "identity",
    key: input.key,
    valueText: input.valueText,
    valueNormalized: input.valueText.toLowerCase(),
    stability: input.stability,
    sourceKind: "explicit",
    confidence: input.confidence,
    cardinality: "single",
    status: "active",
    isPinned: false,
    firstSeenAt: "2026-04-03T12:00:00.000Z",
    lastSeenAt: "2026-04-03T12:00:00.000Z",
    lastConfirmedAt: "2026-04-03T12:00:00.000Z",
    expiresAt: input.stability === "volatile" ? "2026-04-24T12:00:00.000Z" : null,
    supersedesMemoryId: null
  };
}
