import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { config as loadDotenv } from "dotenv";
import { z } from "zod";

import { loadPersona } from "../../src/config/persona.js";
import { OpenAiCompatibleLlmClient } from "../../src/llm/openai-compatible-llm-client.js";
import type { LlmReplyEvalScenario } from "./llm-reply-scenarios.js";
import {
  formatManualReplyEvalMarkdown,
  type ManualReplyEvalRun
} from "./llm-reply-report.js";

const envSchema = z.object({
  LLM_API_KEY: z.string().min(1),
  LLM_BASE_URL: z
    .string()
    .url()
    .default("https://dashscope-intl.aliyuncs.com/compatible-mode/v1"),
  LLM_REPLY_MODEL: z.string().min(1).default("qwen-plus-character"),
  LLM_REPLY_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.6),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(1),
  PERSONA_FILE: z.string().min(1).default("config/persona.md")
});

export async function runManualReplyEval(input: {
  evalName: string;
  outputSlug: string;
  scenarios: readonly LlmReplyEvalScenario[];
}): Promise<void> {
  loadDotenv();

  const raw = normalizeProviderEnv(process.env);
  const env = envSchema.parse(raw);
  const startedAt = new Date().toISOString();
  const runSlug = startedAt.replace(/[:.]/g, "-");
  const outputDir = ".eval-runs";

  const persona = await loadPersona(env.PERSONA_FILE);
  const client = new OpenAiCompatibleLlmClient({
    apiKey: env.LLM_API_KEY,
    baseUrl: env.LLM_BASE_URL,
    replyModel: env.LLM_REPLY_MODEL,
    replyTemperature: env.LLM_REPLY_TEMPERATURE,
    summaryModel: env.LLM_REPLY_MODEL,
    summaryJsonMode: "prompt_only",
    timeoutMs: env.LLM_TIMEOUT_MS,
    maxRetries: env.LLM_MAX_RETRIES
  });

  const run: ManualReplyEvalRun = {
    evalName: input.evalName,
    startedAt,
    model: env.LLM_REPLY_MODEL,
    baseUrl: env.LLM_BASE_URL,
    temperature: env.LLM_REPLY_TEMPERATURE,
    results: []
  };

  console.log(
    `Running ${input.scenarios.length} paid manual reply eval scenarios: ${input.evalName}.`
  );

  for (const scenario of input.scenarios) {
    process.stdout.write(`Running ${scenario.id}... `);

    const result = await client.generateReply({
      persona,
      chatSummary: scenario.chatSummary,
      participantMemoryContext: scenario.participantMemoryContext,
      socialIntent: scenario.socialIntent,
      socialIntentReason: scenario.socialIntentReason,
      resolvedParticipants: scenario.resolvedParticipants,
      socialParticipantContexts: scenario.socialParticipantContexts,
      targetDisplayName: scenario.targetDisplayName,
      reason: scenario.reason,
      replyContext: scenario.replyContext
    });

    run.results.push({
      id: scenario.id,
      title: scenario.title,
      description: scenario.description,
      output: result.text,
      latencyMs: result.latencyMs,
      attemptCount: result.attemptCount,
      promptTokensEstimate: result.promptTokensEstimate,
      humanReview: scenario.humanReview
    });

    process.stdout.write(`${result.latencyMs}ms\n`);
  }

  await mkdir(outputDir, { recursive: true });

  const jsonPath = path.join(outputDir, `${runSlug}-${input.outputSlug}-llm-reply-eval.json`);
  const markdownPath = path.join(
    outputDir,
    `${runSlug}-${input.outputSlug}-llm-reply-eval.md`
  );

  await writeFile(jsonPath, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, `${formatManualReplyEvalMarkdown(run)}\n`, "utf8");

  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${markdownPath}`);
}

function normalizeProviderEnv(
  rawEnv: NodeJS.ProcessEnv
): Record<string, string | undefined> {
  const usesGenericLlmVars =
    rawEnv.LLM_API_KEY !== undefined ||
    rawEnv.LLM_BASE_URL !== undefined ||
    rawEnv.LLM_REPLY_MODEL !== undefined ||
    rawEnv.LLM_REPLY_TEMPERATURE !== undefined ||
    rawEnv.LLM_TIMEOUT_MS !== undefined ||
    rawEnv.LLM_MAX_RETRIES !== undefined;
  const usesLegacyQwenVars =
    rawEnv.QWEN_API_KEY !== undefined ||
    rawEnv.QWEN_BASE_URL !== undefined ||
    rawEnv.QWEN_REPLY_MODEL !== undefined ||
    rawEnv.QWEN_REPLY_TEMPERATURE !== undefined ||
    rawEnv.QWEN_TIMEOUT_MS !== undefined ||
    rawEnv.QWEN_MAX_RETRIES !== undefined;

  if (usesGenericLlmVars && usesLegacyQwenVars) {
    throw new Error(
      "Manual eval config must use either LLM_* or QWEN_* provider variables, not both."
    );
  }

  if (usesGenericLlmVars) {
    return rawEnv;
  }

  return {
    ...rawEnv,
    LLM_API_KEY: rawEnv.QWEN_API_KEY,
    LLM_BASE_URL:
      rawEnv.QWEN_BASE_URL ?? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    LLM_REPLY_MODEL: rawEnv.QWEN_REPLY_MODEL ?? "qwen-plus-character",
    LLM_REPLY_TEMPERATURE: rawEnv.QWEN_REPLY_TEMPERATURE ?? "0.6",
    LLM_TIMEOUT_MS: rawEnv.QWEN_TIMEOUT_MS ?? "20000",
    LLM_MAX_RETRIES: rawEnv.QWEN_MAX_RETRIES ?? "1"
  };
}
