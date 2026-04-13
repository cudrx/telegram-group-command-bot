import { describe, expect, test } from "vitest";

import { llmReplyAdvancedEvalScenarios } from "../scripts/eval/llm-reply-advanced-scenarios.js";
import { llmReplyBaseEvalScenarios } from "../scripts/eval/llm-reply-base-scenarios.js";
import type { LlmReplyEvalScenario } from "../scripts/eval/llm-reply-scenarios.js";

describe("llmReplyEvalScenarios", () => {
  test("defines a cheap base pack and a deeper advanced pack", () => {
    expect(llmReplyBaseEvalScenarios).toHaveLength(3);
    expect(llmReplyAdvancedEvalScenarios).toHaveLength(3);
    expect(uniqueIds(llmReplyBaseEvalScenarios).size).toBe(llmReplyBaseEvalScenarios.length);
    expect(uniqueIds(llmReplyAdvancedEvalScenarios).size).toBe(
      llmReplyAdvancedEvalScenarios.length
    );
    expect(
      new Set([
        ...llmReplyBaseEvalScenarios.map((scenario) => scenario.id),
        ...llmReplyAdvancedEvalScenarios.map((scenario) => scenario.id)
      ]).size
    ).toBe(llmReplyBaseEvalScenarios.length + llmReplyAdvancedEvalScenarios.length);
  });

  test("keeps every scenario reviewable by a human", () => {
    for (const scenario of [
      ...llmReplyBaseEvalScenarios,
      ...llmReplyAdvancedEvalScenarios
    ]) {
      expect(scenario.id).toMatch(/^[a-z0-9_]+$/);
      expect(scenario.title.length).toBeGreaterThan(8);
      expect(scenario.targetDisplayName.length).toBeGreaterThan(1);
      expect(scenario.reason.length).toBeGreaterThan(1);
      expect(scenario.replyContext.triggerMessage).not.toBeNull();
      expect(scenario.humanReview.must.length).toBeGreaterThan(0);
      expect(scenario.humanReview.mustNot.length).toBeGreaterThan(0);
    }
  });

  test("keeps base eval focused on the current reply-loop fix", () => {
    expect(llmReplyBaseEvalScenarios.map((scenario) => scenario.id)).toEqual([
      "omitted_anchor_no_copy",
      "loop_complaint_recovery",
      "short_duplicate_yes_reply"
    ]);
  });

  test("keeps advanced eval focused on future boundary cases", () => {
    expect(llmReplyAdvancedEvalScenarios.map((scenario) => scenario.id)).toEqual([
      "omitted_anchor_quote_pressure",
      "loop_complaint_with_user_insult",
      "short_duplicate_two_word_reply"
    ]);
  });
});

function uniqueIds(scenarios: readonly LlmReplyEvalScenario[]): Set<string> {
  return new Set(scenarios.map((scenario) => scenario.id));
}
