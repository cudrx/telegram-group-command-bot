import { describe, expect, test } from "vitest";

import {
  createEvalLookupContext,
  evaluateRubric,
  filterFixtures,
  hasRubricFailures
} from "../scripts/evaluate-intents.js";
import { intentEvalFixtures } from "../scripts/intent-eval-fixtures.js";

describe("evaluate-intents helpers", () => {
  test("treats summarize regressions as rubric failures", () => {
    const rubric = {
      mustIncludeAny: [["дот"]],
      mustIncludeAll: ["<b>Коротко</b>", "<b>Итог</b>"],
      mustMatchRegex: ["\\n\\n<b>Итог</b>\\s+—"],
      mustNotIncludeAny: [["Summary:"], ["Итог:"]],
      mustNotMatchRegex: ["\\*\\*[^*]+\\*\\*"]
    };

    const result = evaluateRubric("Summary:\n**Коротко**\nИтог: всё", rubric);

    expect(result.exclude.every((check) => check.passed)).toBe(false);
    expect(result.includeAll.every((check) => check.passed)).toBe(false);
    expect(result.matchRegex.every((check) => check.passed)).toBe(false);
    expect(result.notMatchRegex.every((check) => check.passed)).toBe(false);
    expect(hasRubricFailures(result)).toBe(true);
  });

  test("adds fixture lookup context for lookup-backed eval cases", () => {
    const fixture = intentEvalFixtures.find(
      (candidate) => candidate.id === "decide-entity-grounding-dispute"
    );

    expect(fixture).toBeDefined();

    const lookupContext = createEvalLookupContext(fixture!);

    expect(lookupContext).toMatchObject({
      status: "used",
      provider: "tavily",
      intent: "decide",
      decision: {
        shouldLookup: true,
        purpose: "entity_grounding"
      }
    });
    expect(lookupContext?.sources.map((source) => source.title)).toEqual(
      expect.arrayContaining(["Дора", "Мэйби Бэйби"])
    );
    expect(lookupContext?.decision.queries).toEqual(["Дора", "Мэйби Бэйби"]);
    expect(lookupContext?.sources.at(-1)?.content).toContain("Дора");
    expect(lookupContext?.sources.at(-1)?.content).toContain("Мэйби Бэйби");
  });

  test("filters eval fixtures by id and intent", () => {
    expect(
      filterFixtures(intentEvalFixtures, {
        ids: new Set(["decide-factual-dispute"]),
        intents: new Set()
      }).map((fixture) => fixture.id)
    ).toEqual(["decide-factual-dispute"]);

    expect(
      filterFixtures(intentEvalFixtures, {
        ids: new Set(),
        intents: new Set(["summarize"])
      }).map((fixture) => fixture.intent)
    ).toEqual(["summarize", "summarize"]);
  });
});
