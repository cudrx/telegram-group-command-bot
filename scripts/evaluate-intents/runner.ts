import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import OpenAI from 'openai';

import { buildIntentPrompt } from '../../src/llm/prompts.js';
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
