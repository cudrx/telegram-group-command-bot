export type ManualReplyEvalResult = {
  id: string;
  title: string;
  description: string;
  output: string;
  latencyMs: number;
  attemptCount: number;
  promptTokensEstimate: number;
  humanReview: {
    must: string[];
    mustNot: string[];
    notes: string;
  };
};

export type ManualReplyEvalRun = {
  evalName: string;
  startedAt: string;
  model: string;
  baseUrl: string;
  temperature: number;
  results: ManualReplyEvalResult[];
};

export function formatManualReplyEvalMarkdown(run: ManualReplyEvalRun): string {
  return [
    "# Manual LLM Reply Eval",
    "",
    `Eval: \`${run.evalName}\``,
    `Started: \`${run.startedAt}\``,
    `Model: \`${run.model}\``,
    `Base URL: \`${run.baseUrl}\``,
    `Temperature: \`${run.temperature}\``,
    "",
    "Codex should review each answer manually against the checklist. Do not treat this report as an automatic pass/fail test.",
    "",
    ...run.results.flatMap(formatResult)
  ].join("\n");
}

function formatResult(result: ManualReplyEvalResult): string[] {
  return [
    `## ${result.id}`,
    "",
    `Title: ${result.title}`,
    "",
    result.description,
    "",
    `Latency: \`${result.latencyMs}ms\``,
    `Attempts: \`${result.attemptCount}\``,
    `Prompt tokens estimate: \`${result.promptTokensEstimate}\``,
    "",
    "### Model Reply",
    "",
    "```text",
    result.output,
    "```",
    "",
    "### Must",
    "",
    ...result.humanReview.must.map((item) => `- [ ] ${item}`),
    "",
    "### Must Not",
    "",
    ...result.humanReview.mustNot.map((item) => `- [ ] ${item}`),
    "",
    "### Notes",
    "",
    result.humanReview.notes,
    ""
  ];
}
