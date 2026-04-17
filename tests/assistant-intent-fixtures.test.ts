import { describe, expect, test } from "vitest";

import { intentEvalFixtures } from "../scripts/intent-eval-fixtures.js";
import { buildIntentPrompt } from "../src/llm/prompts.js";

describe("intent eval fixtures", () => {
  test("has coverage for each command intent", () => {
    const coveredIntents = new Set(intentEvalFixtures.map((fixture) => fixture.intent));

    expect(coveredIntents).toEqual(new Set(["decide", "explain", "summarize"]));
  });

  test("all fixtures build prompts with their selected mode", () => {
    for (const fixture of intentEvalFixtures) {
      const prompt = buildIntentPrompt(fixture);

      expect(prompt).toContain(`The selected task mode is: ${fixture.intent}`);
      expect(prompt).toContain("BEGIN CHAT TRANSCRIPT");
      expect(prompt).toContain("END CHAT TRANSCRIPT");
    }
  });

  test("explain fixtures use reply anchors instead of command arguments", () => {
    const explainFixtures = intentEvalFixtures.filter((fixture) => fixture.intent === "explain");

    expect(explainFixtures.length).toBeGreaterThan(0);

    for (const fixture of explainFixtures) {
      expect(fixture.replyContext.triggerMessage?.text).toBe("/explain");
      expect(fixture.replyContext.replyAnchorMessage).not.toBe(null);
    }
  });

  test("all fixtures define deterministic rubric checks", () => {
    for (const fixture of intentEvalFixtures) {
      expect(fixture.rubric.mustIncludeAny.length).toBeGreaterThan(0);
      expect(fixture.rubric.mustNotIncludeAny.length).toBeGreaterThan(0);
    }
  });

  test("explain fixtures do not require redirecting to another command", () => {
    const explainFixtures = intentEvalFixtures.filter((fixture) => fixture.intent === "explain");

    for (const fixture of explainFixtures) {
      const includeTerms = fixture.rubric.mustIncludeAny.flat();

      expect(includeTerms).not.toContain("/decide");
      expect(includeTerms).not.toContain("decide");
    }
  });
});
