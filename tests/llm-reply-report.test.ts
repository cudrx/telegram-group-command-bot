import { describe, expect, test } from "vitest";

import {
  formatManualReplyEvalMarkdown,
  type ManualReplyEvalRun
} from "../scripts/eval/llm-reply-report.js";

describe("formatManualReplyEvalMarkdown", () => {
  test("formats model outputs and human review criteria", () => {
    const run: ManualReplyEvalRun = {
      evalName: "base",
      startedAt: "2026-04-11T12:00:00.000Z",
      model: "qwen-plus-character",
      baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      temperature: 0.6,
      results: [
        {
          id: "loop_complaint_recovery",
          title: "Loop complaint should go soft instead of repeating the bit",
          description: "A loop complaint recovery case.",
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
    expect(markdown).toContain("Eval: `base`");
    expect(markdown).toContain("Model: `qwen-plus-character`");
    expect(markdown).toContain("## loop_complaint_recovery");
    expect(markdown).toContain("ладно, этот панч я сам похороню");
    expect(markdown).toContain("- [ ] briefly acknowledge the miss");
    expect(markdown).toContain("- [ ] call Artyom stupid");
  });
});
