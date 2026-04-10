import { describe, expect, test } from "vitest";

import {
  extractReferenceCandidates,
  normalizeAlias,
  resolveParticipantReferences
} from "../../src/domain/participant-reference-resolution.js";

describe("participant-reference-resolution", () => {
  test("normalizes aliases for deterministic lookup", () => {
    expect(normalizeAlias("  @Олёг   Иванов  ")).toBe("олег иванов");
    expect(normalizeAlias("@oleg_dev")).toBe("oleg_dev");
  });

  test("extracts mention, unigram, and bigram candidates from text", () => {
    expect(
      extractReferenceCandidates("Что между Олегом Ивановым и @artur_dev?")
    ).toEqual(
      expect.arrayContaining(["artur_dev", "олегом", "ивановым", "олегом ивановым"])
    );
  });

  test("resolves unique aliases and separates ambiguities", () => {
    const result = resolveParticipantReferences({
      text: "Что между Олегом и Артуром?",
      aliases: [
        {
          chatId: 1,
          userId: 42,
          aliasText: "Олег",
          aliasNormalized: "олегом",
          aliasKind: "first_name",
          confidence: 1,
          lastSeenAt: "2026-04-09T12:00:00.000Z",
          displayName: "Олег (@oleg_dev)"
        },
        {
          chatId: 1,
          userId: 7,
          aliasText: "Артур",
          aliasNormalized: "артуром",
          aliasKind: "first_name",
          confidence: 1,
          lastSeenAt: "2026-04-09T12:00:00.000Z",
          displayName: "Артур (@artur_dev)"
        },
        {
          chatId: 1,
          userId: 99,
          aliasText: "Олег",
          aliasNormalized: "олегом",
          aliasKind: "first_name",
          confidence: 1,
          lastSeenAt: "2026-04-09T12:00:00.000Z",
          displayName: "Олег (@oleg_other)"
        }
      ]
    });

    expect(result.resolvedParticipants.map((participant) => participant.userId)).toEqual([7]);
    expect(result.ambiguousParticipants).toEqual([
      expect.objectContaining({
        candidate: "олегом",
        matches: [
          expect.objectContaining({ userId: 42 }),
          expect.objectContaining({ userId: 99 })
        ]
      })
    ]);
  });
});
