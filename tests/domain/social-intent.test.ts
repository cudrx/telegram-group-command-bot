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

  test("detects participant description requests", () => {
    expect(detectSocialIntent("опиши Хачика")).toEqual({
      isSocialQa: true,
      reason: "participant_description_request"
    });
    expect(detectSocialIntent("что скажешь про Артура?")).toEqual({
      isSocialQa: true,
      reason: "participant_description_request"
    });
    expect(detectSocialIntent("@fun_bot расскажи про Олега")).toEqual({
      isSocialQa: true,
      reason: "participant_description_request"
    });
  });

  test("ignores non-social direct triggers", () => {
    expect(detectSocialIntent("@fun_bot расскажи анекдот")).toEqual({
      isSocialQa: false,
      reason: null
    });
  });
});
