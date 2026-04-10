import { describe, expect, test } from "vitest";

import { detectSocialIntent } from "../../src/domain/social-intent.js";

describe("social-intent", () => {
  test("detects social-QA questions about participants", () => {
    expect(
      detectSocialIntent("что между Олегом и Артуром?")
    ).toEqual({
      isSocialQa: true,
      reason: "relationship_question"
    });
    expect(
      detectSocialIntent("кто поддерживает Сашу сегодня?")
    ).toEqual({
      isSocialQa: true,
      reason: "support_question"
    });
  });

  test("ignores non-social direct triggers", () => {
    expect(detectSocialIntent("@fun_bot расскажи анекдот")).toEqual({
      isSocialQa: false,
      reason: null
    });
  });
});
