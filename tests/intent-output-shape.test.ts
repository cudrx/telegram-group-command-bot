import { describe, expect, test } from "vitest";

import { getIntentOutputShapeViolations } from "../src/llm/intent-output-shape.js";

describe("getIntentOutputShapeViolations", () => {
  test("requires explain HTML sections", () => {
    expect(
      getIntentOutputShapeViolations("explain", [
        "<b>Смысл</b>",
        "Коротко.",
        "",
        "<b>По сути</b>",
        "• пункт",
        "",
        "<b>Вывод</b>",
        "итог"
      ].join("\n"))
    ).toEqual([]);

    expect(getIntentOutputShapeViolations("explain", "просто сухой абзац")).toContain(
      "missing_explain_shape"
    );
  });

  test("requires summarize heading and separated final takeaway", () => {
    expect(
      getIntentOutputShapeViolations("summarize", [
        "<b>Коротко</b>",
        "• один",
        "• два",
        "",
        "<b>Итог</b> — вывод"
      ].join("\n"))
    ).toEqual([]);

    expect(
      getIntentOutputShapeViolations("summarize", [
        "<b>Коротко</b>",
        "• один",
        "<b>Итог</b> — вывод"
      ].join("\n"))
    ).toContain("missing_summarize_shape");
  });

  test("requires decide HTML sections and catches markdown leaks", () => {
    expect(
      getIntentOutputShapeViolations("decide", [
        "<b>Позиции</b>",
        "• A",
        "",
        "<b>Что видно</b>",
        "• факт",
        "",
        "<b>Вердикт</b>",
        "вывод"
      ].join("\n"))
    ).toEqual([]);

    expect(getIntentOutputShapeViolations("decide", "Summary:\n**oops**")).toEqual(
      expect.arrayContaining(["english_summary_heading", "markdown_bold", "missing_decide_shape"])
    );
  });
});
