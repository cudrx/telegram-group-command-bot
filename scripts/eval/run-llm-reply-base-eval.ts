import { llmReplyBaseEvalScenarios } from "./llm-reply-base-scenarios.js";
import { runManualReplyEval } from "./run-manual-reply-eval.js";

await runManualReplyEval({
  evalName: "base",
  outputSlug: "base",
  scenarios: llmReplyBaseEvalScenarios
});
