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

  test("summarize fixtures guard against heading and styling regressions", () => {
    const summarizeFixtures = intentEvalFixtures.filter((fixture) => fixture.intent === "summarize");

    expect(summarizeFixtures).toHaveLength(1);
    expect(summarizeFixtures[0]?.rubric.mustNotIncludeAny).toEqual(
      expect.arrayContaining([["Summary:"], ["**"], ["Итог:"]])
    );
    expect(summarizeFixtures[0]?.rubric.mustIncludeAny).toEqual(
      expect.arrayContaining([["\n\n<b>Итог</b>"]])
    );
  });

  test("fixtures accept common Russian and normalized English wording", () => {
    const slangFixture = intentEvalFixtures.find(
      (fixture) => fixture.id === "explain-non-question-slang-anchor"
    );
    const summarizeFixture = intentEvalFixtures.find(
      (fixture) => fixture.id === "summarize-dota-scheduling"
    );
    const noDisputeFixture = intentEvalFixtures.find(
      (fixture) => fixture.id === "decide-no-dispute"
    );

    expect(slangFixture?.rubric.mustIncludeAny).toEqual(
      expect.arrayContaining([expect.arrayContaining(["зацепил", "не надоедает", "качествен", "повтор"])])
    );
    const lionFixture = intentEvalFixtures.find(
      (fixture) => fixture.id === "explain-reply-anchor-lion-vs-tiger"
    );

    expect(lionFixture?.rubric.mustIncludeAny).toEqual(
      expect.arrayContaining([expect.arrayContaining(["схватк", "противостояни", "столкновен"])])
    );
    expect(summarizeFixture?.rubric.mustIncludeAny).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(["dota", "дота"]),
        expect.arrayContaining(["после 22", "22:00", "после 22:00"]),
        expect.arrayContaining(["поздн", "неудоб"])
      ])
    );
    expect(noDisputeFixture?.rubric.mustIncludeAny).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          "отсутствует спор",
          "спор отсутствует",
          "диспут отсутствует",
          "не содержит признаков спора",
          "без конфликта",
          "отсутствуют противореч"
        ])
      ])
    );
  });

  test("lookup fixtures cover entity grounding expectations", () => {
    const lookupFixtures = intentEvalFixtures.filter((fixture) => fixture.lookupExpectation);

    expect(lookupFixtures.length).toBeGreaterThanOrEqual(1);
    expect(
      lookupFixtures.some((fixture) => fixture.lookupExpectation?.purpose === "entity_grounding")
    ).toBe(true);
  });

  test("Dora entity-grounding fixture keeps the lookup mock focused on canonical compared artists", () => {
    const doraFixture = intentEvalFixtures.find(
      (fixture) => fixture.id === "decide-dora-maybe-baby-entity-grounding"
    );

    expect(doraFixture?.lookupExpectation?.includeTerms).toEqual(["Дора", "Мэйби Бэйби"]);
    expect(doraFixture?.rubric.mustIncludeAny).toEqual(
      expect.arrayContaining([expect.arrayContaining(["Дора", "Дор"])])
    );
    expect(doraFixture?.rubric.mustIncludeAny).toEqual(
      expect.arrayContaining([expect.arrayContaining(["концерт", "концертный", "выступлен"])])
    );
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
