import 'dotenv/config';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import OpenAI from 'openai';
import { answerActionConfig } from '../src/config/runtime/index.js';
import {
  buildAnswerMessages,
  generateAnswer
} from '../src/llm/openai-compatible-client/answer.js';
import { estimateTokens } from '../src/llm/openai-compatible-client/logging.js';
import type { ChatCompletionsCreate } from '../src/llm/openai-compatible-client/types.js';
import {
  compareProductionPrompts,
  type ExperimentMessage,
  getReplyAncestorIds,
  type HistoryVariant,
  readTranscriptRow,
  transformExperimentMessages
} from './evaluate-conversation/context.js';
import { parseEvalEnv } from './evaluate-intents/env.js';
import {
  evaluateRubric,
  hasRubricFailures
} from './evaluate-intents/scoring.js';
import { socialEvalCases } from './intent-eval-fixtures/social.js';

const variants = {
  A: { history: 'full', policy: false },
  B: { history: 'omitted', policy: false },
  C: { history: 'ancestors', policy: false },
  D: { history: 'full', policy: true }
} satisfies Record<string, { history: HistoryVariant; policy: boolean }>;

type Variant = keyof typeof variants;
type Case = (typeof socialEvalCases)[number];

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function humanRows(messages: ExperimentMessage[]): string[] {
  return messages
    .filter((message) => message.role === 'user')
    .flatMap((message) => message.content.split('\n'))
    .filter((line) => readTranscriptRow(line)?.isBot === false);
}

function prepare(
  item: Case,
  variant: Variant,
  policy: string,
  savedBaseline?: ExperimentMessage[]
) {
  // Filter only AFTER production budget fitting. Freed space cannot admit new humans.
  const baseline = buildAnswerMessages(item.fixture);
  const config = variants[variant];
  if (savedBaseline && variant !== 'A' && variant !== 'D')
    throw new Error('Production comparison supports only variants A,D');

  const messages = savedBaseline
    ? compareProductionPrompts(savedBaseline, baseline, variant as 'A' | 'D')
    : transformExperimentMessages(
        baseline,
        config.history,
        getReplyAncestorIds(item.fixture.replyContext)
      );
  const system = messages[0];
  if (!savedBaseline && config.policy && system)
    system.content += `\n\nCONVERSATION_POLICY_EXPERIMENT:\n${policy}`;

  const humanHash = hash(JSON.stringify(humanRows(messages)));
  if (humanHash !== hash(JSON.stringify(humanRows(baseline))))
    throw new Error('Experiment changed fitted human history');

  const promptTokensEstimate = estimateTokens(
    messages.map((message) => message.content).join('\n\n')
  );
  if (promptTokensEstimate > answerActionConfig.context.maxPromptTokens)
    throw new Error('Experimental prompt exceeds production token budget');

  const rows = messages
    .filter((message) => message.role === 'user')
    .flatMap((message) => message.content.split('\n'))
    .flatMap((line) => readTranscriptRow(line) ?? []);

  return {
    messages,
    humanHash,
    promptTokensEstimate,
    visibleIds: rows.map((row) => row.id)
  };
}

export async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      repetitions: { type: 'string', default: '2' },
      concurrency: { type: 'string', default: '3' },
      id: { type: 'string' },
      variants: { type: 'string' },
      'baseline-manifest': { type: 'string' }
    }
  });
  const repetitions = Number(values.repetitions);
  const concurrency = Number(values.concurrency);
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 3)
    throw new Error('repetitions must be 1..3');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4)
    throw new Error('concurrency must be 1..4');

  const selectedVariants = (
    values.variants ?? (values['baseline-manifest'] ? 'A,D' : 'A,B,C,D')
  ).split(',') as Variant[];
  if (
    new Set(selectedVariants).size !== selectedVariants.length ||
    selectedVariants.some((variant) => !Object.hasOwn(variants, variant))
  )
    throw new Error('variants must be a unique subset of A,B,C,D');

  const cases = socialEvalCases.filter(
    (item) => !values.id || item.fixture.id === values.id
  );
  if (!cases.length) throw new Error('No matching scenarios');

  const policy = values['baseline-manifest']
    ? ''
    : (await readFile('llm/experiments/conversation-policy.md', 'utf8')).trim();
  type SavedInput = {
    id: string;
    variant: string;
    repeat: number;
    messages: ExperimentMessage[];
  };
  const saved = values['baseline-manifest']
    ? (JSON.parse(await readFile(values['baseline-manifest'], 'utf8')) as {
        inputs: SavedInput[];
      })
    : null;
  const savedBaselines = new Map(
    saved?.inputs
      .filter((input) => input.variant === 'A' && input.repeat === 1)
      .map((input) => [input.id, input.messages])
  );
  if (saved && cases.some((item) => !savedBaselines.has(item.fixture.id)))
    throw new Error('Saved baseline is missing a requested scenario');
  const outputDir = path.join(
    '.eval-runs',
    `conversation-${new Date().toISOString().replace(/[:.]/g, '-')}`
  );
  await mkdir(outputDir, { recursive: true });
  const jobs = Array.from({ length: repetitions }, (_, repeat) =>
    cases.flatMap((item, index) => {
      const offset = (index + repeat) % selectedVariants.length;
      const order = [
        ...selectedVariants.slice(offset),
        ...selectedVariants.slice(0, offset)
      ];

      return order.map((variant) => ({ item, variant, repeat: repeat + 1 }));
    })
  ).flat();
  const prepared = jobs.map((job) => ({
    ...job,
    ...prepare(
      job.item,
      job.variant,
      policy,
      savedBaselines.get(job.item.fixture.id)
    )
  }));
  const manifest = {
    generatedAt: new Date().toISOString(),
    kind: saved
      ? 'saved production baseline A versus current production prompt D'
      : 'synthetic single-checkpoint experiment; not a production replay or an independent blind evaluation',
    baselineManifest: values['baseline-manifest'] ?? null,
    repetitions,
    concurrency,
    totalJobs: jobs.length,
    variants: saved
      ? {
          A: { history: 'full', policy: 'saved production' },
          D: { history: 'full', policy: 'current production' }
        }
      : variants,
    policy: saved ? null : policy,
    policySha256: saved ? null : hash(policy),
    cases: cases.map(({ fixture, ...metadata }) => ({
      id: fixture.id,
      ...metadata
    })),
    inputs: prepared.map(({ item, variant, repeat, ...input }) => ({
      id: item.fixture.id,
      variant,
      repeat,
      ...input
    }))
  };
  await writeFile(
    path.join(outputDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
  console.log(
    JSON.stringify({
      outputDir,
      scenarios: cases.length,
      jobs: jobs.length,
      dryRun: values['dry-run']
    })
  );
  if (values['dry-run']) return;

  const env = parseEvalEnv();
  const config = {
    apiKey: env.llmApiKey,
    baseUrl: env.llmBaseUrl,
    replyModel: env.llmReplyModel,
    replyTemperature: env.llmReplyTemperature,
    timeoutMs: 45_000,
    maxRetries: 0
  };
  await writeFile(
    path.join(outputDir, 'settings.json'),
    JSON.stringify(
      {
        model: env.llmReplyModel,
        temperature: env.llmReplyTemperature,
        timeoutMs: 45_000,
        retries: 0,
        thinking: 'disabled',
        lookup: 'route only; no web calls',
        productionPromptComparison: saved !== null
      },
      null,
      2
    )
  );
  const client = new OpenAI({
    apiKey: env.llmApiKey,
    baseURL: env.llmBaseUrl,
    timeout: 45_000,
    maxRetries: 0
  });
  let next = 0;
  let errors = 0;
  const results: Array<Record<string, unknown>> = [];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < prepared.length) {
        const job = prepared[next++];
        if (!job) break;
        const { item, variant, repeat } = job;
        const started = Date.now();
        let actualModel: string | null = null;
        let usage: unknown = null;
        let raw: string | null = null;
        const createCompletion = (async (params: Record<string, unknown>) => {
          const completion = await client.chat.completions.create({
            ...params,
            messages: job.messages
          } as never);
          actualModel = completion.model;
          usage = completion.usage;
          raw = completion.choices[0]?.message.content ?? null;

          return completion;
        }) as unknown as ChatCompletionsCreate;
        let result: Record<string, unknown>;
        try {
          const generated = await generateAnswer({
            config,
            createCompletion,
            request: item.fixture
          });
          const decision = generated.decision;
          const text = 'text' in decision ? decision.text : '';
          const rubric = evaluateRubric(text, item.fixture.rubric);
          const selectedIds =
            'context' in decision ? decision.context.messageIds : [];
          const hiddenSelectedIds = selectedIds.filter(
            (id) => !job.visibleIds.includes(id)
          );
          result = {
            id: item.fixture.id,
            category: item.category,
            variant,
            repeat,
            decision,
            text,
            actualModel,
            usage,
            latencyMs: Date.now() - started,
            promptTokensEstimate: job.promptTokensEstimate,
            humanHash: job.humanHash,
            requiredBotContextAvailable: item.requiredBotMessageIds.every(
              (id) => job.visibleIds.includes(id)
            ),
            automaticChecks: {
              expectedMode: decision.mode === item.fixture.expectedMode,
              lexical: !hasRubricFailures(rubric),
              length: text.length <= item.maxResponseChars,
              visibleContextIds: hiddenSelectedIds.length === 0
            },
            rubric,
            hiddenSelectedIds,
            responseChars: text.length
          };
        } catch (error) {
          errors++;
          const candidate = error as { name?: string; status?: number };
          result = {
            id: item.fixture.id,
            category: item.category,
            variant,
            repeat,
            error: {
              name: candidate.name ?? 'Error',
              status: candidate.status ?? null
            },
            raw,
            actualModel,
            usage,
            latencyMs: Date.now() - started
          };
        }
        const completed = results.push(result);
        await appendFile(
          path.join(outputDir, 'results.jsonl'),
          `${JSON.stringify(result)}\n`
        );
        console.log(
          JSON.stringify({
            completed,
            total: jobs.length,
            id: item.fixture.id,
            variant,
            repeat,
            checks: result.automaticChecks,
            error: result.error
          })
        );
        // A failed provider/authentication probe should not produce dozens of identical calls.
        if (errors >= concurrency && results.every((result) => result.error)) {
          next = prepared.length;
          break;
        }
      }
    })
  );
  await writeFile(
    path.join(outputDir, 'results.json'),
    JSON.stringify(results, null, 2)
  );
  console.log(
    JSON.stringify({
      outputDir,
      completed: results.length,
      expected: jobs.length,
      errors
    })
  );
  if (errors || results.length !== jobs.length) process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
