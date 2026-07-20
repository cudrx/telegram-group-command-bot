import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import OpenAI from 'openai';

import { OpenAiCompatibleLlmClient } from '../../src/llm/openai-compatible-client/index.js';
import { buildIntentPrompt } from '../../src/llm/prompts.js';
import { text } from '../../src/locales/locale.js';
import { intentEvalFixtures } from '../intent-eval-fixtures.js';
import { parseEvalEnv } from './env.js';
import { filterFixtures, parseEvalFilters } from './filters.js';
import { createEvalLookupContext } from './lookup-context.js';
import { formatMarkdown, printResult } from './reporting.js';
import { evaluateRubric, hasRubricFailures } from './scoring.js';
import type { EvalResult } from './types.js';

export async function main(): Promise<number> {
  const env = parseEvalEnv(process.env);
  const client = new OpenAI({
    apiKey: env.llmApiKey,
    baseURL: env.llmBaseUrl
  });
  const llm = new OpenAiCompatibleLlmClient(
    {
      apiKey: env.llmApiKey,
      baseUrl: env.llmBaseUrl,
      replyModel: env.llmReplyModel,
      replyTemperature: env.llmReplyTemperature,
      timeoutMs: 45_000,
      maxRetries: 0
    },
    client
  );
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
    const response =
      fixture.intent === 'answer'
        ? await evaluateAnswer(llm, fixture)
        : ((
            await client.chat.completions.create({
              model: env.llmReplyModel,
              temperature: env.llmReplyTemperature,
              messages: [
                { role: 'system', content: text.llm.evalSystem },
                { role: 'user', content: prompt }
              ]
            })
          ).choices[0]?.message.content?.trim() ?? '');
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

async function evaluateAnswer(
  llm: OpenAiCompatibleLlmClient,
  fixture: (typeof intentEvalFixtures)[number]
): Promise<string> {
  const input = {
    assistantInstructions: fixture.assistantInstructions,
    targetDisplayName: fixture.targetDisplayName,
    currentDateTime: fixture.currentDateTime,
    replyContext: fixture.replyContext,
    mediaContext: fixture.mediaContext ?? null
  };
  const first = await llm.generateAnswer(input);
  const expectsLookup = fixture.lookupExpectation?.shouldLookup ?? false;

  if ((first.decision.mode === 'research') !== expectsLookup) {
    throw new Error(
      `${fixture.id}: expected ${expectsLookup ? 'research' : 'direct'} answer route, got ${first.decision.mode}`
    );
  }

  if (first.decision.mode === 'direct') return first.decision.text;
  if (first.decision.mode !== 'research') {
    throw new Error(`${fixture.id}: invalid preflight mode`);
  }

  const lookup = createEvalLookupContext(fixture);
  const grounded = await llm.generateAnswer({
    ...input,
    research: {
      plan: first.decision,
      result: {
        query: lookup?.query ?? first.decision.query,
        sources: (lookup?.sources ?? []).map((source, index) => ({
          id: `web_${index + 1}`,
          ...source
        }))
      }
    }
  });

  if (grounded.decision.mode !== 'grounded') {
    throw new Error(`${fixture.id}: grounded answer was not returned`);
  }

  return grounded.decision.text;
}
