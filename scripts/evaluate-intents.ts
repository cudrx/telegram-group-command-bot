import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import OpenAI from "openai";

import { parseEnv } from "../src/config/env.js";
import { buildIntentPrompt } from "../src/llm/prompts.js";
import { intentEvalFixtures } from "./intent-eval-fixtures.js";

type RubricResult = {
  include: Array<{ group: string[]; passed: boolean }>;
  exclude: Array<{ group: string[]; passed: boolean }>;
};

type EvalResult = {
  id: string;
  intent: string;
  response: string;
  rubric: RubricResult;
};

const env = parseEnv(process.env);
const client = new OpenAI({
  apiKey: env.llmApiKey,
  baseURL: env.llmBaseUrl
});
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.join(".eval-runs", timestamp);
const results: EvalResult[] = [];

await mkdir(outputDir, { recursive: true });

for (const fixture of intentEvalFixtures) {
  const prompt = buildIntentPrompt(fixture);
  const completion = await client.chat.completions.create({
    model: env.llmReplyModel,
    temperature: env.llmReplyTemperature,
    messages: [
      {
        role: "system",
        content: "You are a careful Telegram chat assistant. Answer in Russian."
      },
      {
        role: "user",
        content: prompt
      }
    ]
  });
  const response = completion.choices[0]?.message.content?.trim() ?? "";
  const result = {
    id: fixture.id,
    intent: fixture.intent,
    response,
    rubric: evaluateRubric(response, fixture.rubric)
  };

  results.push(result);
  printResult(result);
}

await writeFile(
  path.join(outputDir, "assistant-intents.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2),
  "utf8"
);
await writeFile(path.join(outputDir, "assistant-intents.md"), formatMarkdown(results), "utf8");

console.log("");
console.log(`Saved eval results to ${outputDir}`);

function evaluateRubric(
  response: string,
  rubric: {
    mustIncludeAny: string[][];
    mustNotIncludeAny: string[][];
  }
): RubricResult {
  const normalized = response.toLowerCase();

  return {
    include: rubric.mustIncludeAny.map((group) => ({
      group,
      passed: group.some((term) => normalized.includes(term.toLowerCase()))
    })),
    exclude: rubric.mustNotIncludeAny.map((group) => ({
      group,
      passed: group.every((term) => !normalized.includes(term.toLowerCase()))
    }))
  };
}

function printResult(result: EvalResult): void {
  console.log("");
  console.log(`=== ${result.id} (${result.intent}) ===`);
  console.log(result.response);
  console.log("");
  console.log("Rubric:");

  for (const check of result.rubric.include) {
    console.log(`${check.passed ? "PASS" : "FAIL"} include any: ${check.group.join(" | ")}`);
  }

  for (const check of result.rubric.exclude) {
    console.log(`${check.passed ? "PASS" : "FAIL"} exclude all: ${check.group.join(" | ")}`);
  }
}

function formatMarkdown(results: EvalResult[]): string {
  return [
    "# Assistant Intent Eval Results",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    ...results.flatMap((result) => [
      `## ${result.id} (${result.intent})`,
      "",
      result.response,
      "",
      "### Rubric",
      "",
      ...result.rubric.include.map(
        (check) => `- ${check.passed ? "PASS" : "FAIL"} include any: ${check.group.join(" | ")}`
      ),
      ...result.rubric.exclude.map(
        (check) => `- ${check.passed ? "PASS" : "FAIL"} exclude all: ${check.group.join(" | ")}`
      ),
      ""
    ])
  ].join("\n");
}
