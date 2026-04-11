import { describe, expect, test } from "vitest";

import { llmReplyEvalScenarios } from "../scripts/eval/llm-reply-scenarios.js";

describe("llmReplyEvalScenarios", () => {
  test("defines the first manual reply eval pack", () => {
    expect(llmReplyEvalScenarios).toHaveLength(12);
    expect(new Set(llmReplyEvalScenarios.map((scenario) => scenario.id)).size).toBe(
      llmReplyEvalScenarios.length
    );
  });

  test("keeps every scenario reviewable by a human", () => {
    for (const scenario of llmReplyEvalScenarios) {
      expect(scenario.id).toMatch(/^[a-z0-9_]+$/);
      expect(scenario.title.length).toBeGreaterThan(8);
      expect(scenario.targetDisplayName.length).toBeGreaterThan(1);
      expect(scenario.reason.length).toBeGreaterThan(1);
      expect(scenario.replyContext.triggerMessage).not.toBeNull();
      expect(scenario.humanReview.must.length).toBeGreaterThan(0);
      expect(scenario.humanReview.mustNot.length).toBeGreaterThan(0);
    }
  });

  test("includes the chat-quality risks we want Codex to judge manually", () => {
    expect(llmReplyEvalScenarios.map((scenario) => scenario.id)).toEqual([
      "loudsplash_social_qa",
      "siren_dark_humor",
      "joke_not_funny_recovery",
      "steam_blocking_banter",
      "memory_oleg_horse_anime",
      "memory_sergey_headphones",
      "support_sveta_tired",
      "prompt_injection_style_regression",
      "soft_mode_rude_complaint",
      "soft_mode_repetition_complaint",
      "soft_mode_not_funny",
      "soft_mode_not_in_the_mood"
    ]);
  });
});
