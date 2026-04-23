import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import OpenAI from 'openai';

import { parseEnv } from '../src/config/env/index.js';
import { buildIntentPrompt } from '../src/llm/prompts.js';
import type { LookupContext, LookupSource } from '../src/lookup/types.js';
import {
  type IntentEvalFixture,
  intentEvalFixtures
} from './intent-eval-fixtures.js';

export type RubricResult = {
  include: Array<{ group: string[]; passed: boolean }>;
  includeAll: Array<{ term: string; passed: boolean }>;
  matchRegex: Array<{ pattern: string; passed: boolean }>;
  exclude: Array<{ group: string[]; passed: boolean }>;
  notMatchRegex: Array<{ pattern: string; passed: boolean }>;
};

export type EvalResult = {
  id: string;
  intent: string;
  prompt: string;
  response: string;
  rubric: RubricResult;
};

type EvalFilters = {
  ids: Set<string>;
  intents: Set<string>;
};

export function evaluateRubric(
  response: string,
  rubric: {
    mustIncludeAny: string[][];
    mustIncludeAll?: string[];
    mustMatchRegex?: string[];
    mustNotIncludeAny: string[][];
    mustNotMatchRegex?: string[];
  }
): RubricResult {
  const normalized = response.toLowerCase();

  return {
    include: rubric.mustIncludeAny.map((group) => ({
      group,
      passed: group.some((term) => normalized.includes(term.toLowerCase()))
    })),
    includeAll: (rubric.mustIncludeAll ?? []).map((term) => ({
      term,
      passed: normalized.includes(term.toLowerCase())
    })),
    matchRegex: (rubric.mustMatchRegex ?? []).map((pattern) => ({
      pattern,
      passed: new RegExp(pattern, 'iu').test(response)
    })),
    exclude: rubric.mustNotIncludeAny.map((group) => ({
      group,
      passed: group.every((term) => !normalized.includes(term.toLowerCase()))
    })),
    notMatchRegex: (rubric.mustNotMatchRegex ?? []).map((pattern) => ({
      pattern,
      passed: !new RegExp(pattern, 'iu').test(response)
    }))
  };
}

export function hasRubricFailures(rubric: RubricResult): boolean {
  return (
    rubric.include.some((check) => !check.passed) ||
    rubric.includeAll.some((check) => !check.passed) ||
    rubric.matchRegex.some((check) => !check.passed) ||
    rubric.exclude.some((check) => !check.passed) ||
    rubric.notMatchRegex.some((check) => !check.passed)
  );
}

export async function main(): Promise<number> {
  const env = parseEnv(process.env);
  const client = new OpenAI({
    apiKey: env.llmApiKey,
    baseURL: env.llmBaseUrl
  });
  const results: EvalResult[] = [];
  const filters = parseEvalFilters(process.argv.slice(2));
  const selectedFixtures = filterFixtures(intentEvalFixtures, filters);

  if (selectedFixtures.length === 0) {
    throw new Error('No intent eval fixtures matched the provided filters.');
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDir = path.join('.eval-runs', timestamp);

  await mkdir(outputDir, { recursive: true });

  console.log(
    `Running ${selectedFixtures.length}/${intentEvalFixtures.length} intent eval fixture(s).`
  );

  for (const fixture of selectedFixtures) {
    const prompt = buildIntentPrompt({
      ...fixture,
      lookupContext: createEvalLookupContext(fixture)
    });
    const completion = await client.chat.completions.create({
      model: env.llmReplyModel,
      temperature: env.llmReplyTemperature,
      messages: [
        {
          role: 'system',
          content:
            'You are a careful Telegram chat assistant. Answer in Russian.'
        },
        {
          role: 'user',
          content: prompt
        }
      ]
    });
    const response = completion.choices[0]?.message.content?.trim() ?? '';
    const result = {
      id: fixture.id,
      intent: fixture.intent,
      prompt,
      response,
      rubric: evaluateRubric(response, fixture.rubric)
    };

    results.push(result);
    printResult(result);
  }

  await writeFile(
    path.join(outputDir, 'assistant-intents.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2),
    'utf8'
  );
  await writeFile(
    path.join(outputDir, 'assistant-intents.md'),
    formatMarkdown(results),
    'utf8'
  );

  console.log('');
  console.log(`Saved eval results to ${outputDir}`);

  if (results.some((result) => hasRubricFailures(result.rubric))) {
    process.exitCode = 1;
    console.error('One or more rubric checks failed.');
  }

  return typeof process.exitCode === 'number' ? process.exitCode : 0;
}

export function parseEvalFilters(args: string[]): EvalFilters {
  const filters: EvalFilters = {
    ids: new Set(),
    intents: new Set()
  };

  for (const arg of args) {
    if (arg.startsWith('--id=')) {
      addCsvValues(filters.ids, arg.slice('--id='.length));
      continue;
    }

    if (arg.startsWith('--intent=')) {
      addCsvValues(filters.intents, arg.slice('--intent='.length));
      continue;
    }

    if (arg.length > 0) {
      filters.ids.add(arg);
    }
  }

  return filters;
}

export function filterFixtures(
  fixtures: IntentEvalFixture[],
  filters: EvalFilters
): IntentEvalFixture[] {
  return fixtures.filter((fixture) => {
    const idMatches = filters.ids.size === 0 || filters.ids.has(fixture.id);
    const intentMatches =
      filters.intents.size === 0 || filters.intents.has(fixture.intent);

    return idMatches && intentMatches;
  });
}

function addCsvValues(target: Set<string>, value: string): void {
  for (const item of value.split(',')) {
    const normalized = item.trim();

    if (normalized.length > 0) {
      target.add(normalized);
    }
  }
}

export function createEvalLookupContext(
  fixture: IntentEvalFixture
): LookupContext | null {
  if (
    !fixture.lookupExpectation ||
    fixture.intent === 'summarize' ||
    fixture.intent === 'read'
  ) {
    return null;
  }

  return {
    status: fixture.lookupExpectation.shouldLookup ? 'used' : 'skipped',
    provider: fixture.lookupExpectation.shouldLookup ? 'tavily' : null,
    intent: fixture.intent,
    decision: {
      shouldLookup: fixture.lookupExpectation.shouldLookup,
      purpose: fixture.lookupExpectation.purpose,
      reason: 'Fixture-provided lookup context for intent eval.',
      queries: fixture.lookupExpectation.includeTerms,
      confidence: fixture.lookupExpectation.shouldLookup ? 'high' : 'low'
    },
    query: fixture.lookupExpectation.includeTerms.join(' '),
    sources: fixture.lookupExpectation.shouldLookup
      ? createEvalLookupSources(fixture.lookupExpectation.includeTerms)
      : [],
    responseTimeMs: null,
    usageCredits: null,
    errorMessage: null
  };
}

function createEvalLookupSources(includeTerms: string[]): LookupSource[] {
  const sources = includeTerms.map<LookupSource>((term) => ({
    title: term,
    url: `https://example.test/intent-eval-lookup/${encodeURIComponent(term)}`,
    content: `${term} is a central named entity in this fixture.`,
    score: 1
  }));

  return [
    ...sources,
    {
      title: includeTerms.join(' / '),
      url: 'https://example.test/intent-eval-lookup',
      content: includeTerms.join('. '),
      score: 1
    }
  ];
}

function printResult(result: EvalResult): void {
  console.log('');
  console.log(`=== ${result.id} (${result.intent}) ===`);
  console.log(result.response);
  console.log('');
  console.log('Rubric:');

  for (const check of result.rubric.include) {
    console.log(
      `${check.passed ? 'PASS' : 'FAIL'} include any: ${check.group.join(' | ')}`
    );
  }

  for (const check of result.rubric.includeAll) {
    console.log(`${check.passed ? 'PASS' : 'FAIL'} include all: ${check.term}`);
  }

  for (const check of result.rubric.matchRegex) {
    console.log(
      `${check.passed ? 'PASS' : 'FAIL'} match regex: ${check.pattern}`
    );
  }

  for (const check of result.rubric.exclude) {
    console.log(
      `${check.passed ? 'PASS' : 'FAIL'} exclude all: ${check.group.join(' | ')}`
    );
  }

  for (const check of result.rubric.notMatchRegex) {
    console.log(
      `${check.passed ? 'PASS' : 'FAIL'} not match regex: ${check.pattern}`
    );
  }
}

function formatMarkdown(results: EvalResult[]): string {
  return [
    '# Assistant Intent Eval Results',
    '',
    `Generated at: ${new Date().toISOString()}`,
    '',
    ...results.flatMap((result) => [
      `## ${result.id} (${result.intent})`,
      '',
      '### Prompt',
      '',
      '```text',
      result.prompt,
      '```',
      '',
      '### Response',
      '',
      result.response,
      '',
      '### Rubric',
      '',
      ...result.rubric.include.map(
        (check) =>
          `- ${check.passed ? 'PASS' : 'FAIL'} include any: ${check.group.join(' | ')}`
      ),
      ...result.rubric.includeAll.map(
        (check) =>
          `- ${check.passed ? 'PASS' : 'FAIL'} include all: ${check.term}`
      ),
      ...result.rubric.matchRegex.map(
        (check) =>
          `- ${check.passed ? 'PASS' : 'FAIL'} match regex: ${check.pattern}`
      ),
      ...result.rubric.exclude.map(
        (check) =>
          `- ${check.passed ? 'PASS' : 'FAIL'} exclude all: ${check.group.join(' | ')}`
      ),
      ...result.rubric.notMatchRegex.map(
        (check) =>
          `- ${check.passed ? 'PASS' : 'FAIL'} not match regex: ${check.pattern}`
      ),
      ''
    ])
  ].join('\n');
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
