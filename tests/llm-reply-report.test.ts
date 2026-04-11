import { describe, expect, test } from "vitest";

import {
  formatManualReplyEvalMarkdown,
  type ManualReplyEvalRun
} from "../scripts/eval/llm-reply-report.js";

describe("formatManualReplyEvalMarkdown", () => {
  test("formats model outputs and human review criteria", () => {
    const run: ManualReplyEvalRun = {
      startedAt: "2026-04-11T12:00:00.000Z",
      model: "qwen-plus-character",
      baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      temperature: 0.6,
      results: [
        {
          id: "joke_not_funny_recovery",
          title: "Recover when the user says the joke was not funny",
          description: "A bad joke recovery case.",
          output: "ладно, этот панч я сам похороню",
          latencyMs: 1200,
          attemptCount: 1,
          promptTokensEstimate: 900,
          humanReview: {
            must: ["briefly acknowledge the miss"],
            mustNot: ["call Artyom stupid"],
            notes: "Should go softer."
          }
        }
      ]
    };

    const markdown = formatManualReplyEvalMarkdown(run);

    expect(markdown).toContain("# Manual LLM Reply Eval");
    expect(markdown).toContain("Model: `qwen-plus-character`");
    expect(markdown).toContain("## joke_not_funny_recovery");
    expect(markdown).toContain("ладно, этот панч я сам похороню");
    expect(markdown).toContain("- [ ] briefly acknowledge the miss");
    expect(markdown).toContain("- [ ] call Artyom stupid");
  });
});
