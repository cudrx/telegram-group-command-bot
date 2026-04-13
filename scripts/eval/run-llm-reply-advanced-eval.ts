import { llmReplyAdvancedEvalScenarios } from "./llm-reply-advanced-scenarios.js";
import { runManualReplyEval } from "./run-manual-reply-eval.js";

await runManualReplyEval({
  evalName: "advanced",
  outputSlug: "advanced",
  scenarios: llmReplyAdvancedEvalScenarios
});
