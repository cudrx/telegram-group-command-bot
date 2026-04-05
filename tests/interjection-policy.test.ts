import { describe, expect, test } from "vitest";

import { shouldInterject } from "../src/domain/interjection-policy.js";

describe("shouldInterject", () => {
  test("returns true when random value is below probability and cooldown expired", () => {
    expect(
      shouldInterject({
        probability: 0.15,
        randomValue: 0.03,
        cooldownMs: 1_800_000,
        lastBotMessageAt: "2026-04-03T09:00:00.000Z",
        now: "2026-04-03T10:00:00.000Z"
      })
    ).toBe(true);
  });

  test("returns false when cooldown is still active", () => {
    expect(
      shouldInterject({
        probability: 0.15,
        randomValue: 0.03,
        cooldownMs: 1_800_000,
        lastBotMessageAt: "2026-04-03T09:45:00.000Z",
        now: "2026-04-03T10:00:00.000Z"
      })
    ).toBe(false);
  });

  test("returns false when random value is above probability", () => {
    expect(
      shouldInterject({
        probability: 0.15,
        randomValue: 0.45,
        cooldownMs: 1_800_000,
        lastBotMessageAt: null,
        now: "2026-04-03T10:00:00.000Z"
      })
    ).toBe(false);
  });
});
