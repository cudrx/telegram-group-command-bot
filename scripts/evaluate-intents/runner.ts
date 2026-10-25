import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import OpenAI from 'openai';
import {
  buildAnswerMessages,
  selectAnswerContext
} from '../../src/llm/openai-compatible-client/answer.js';
import { OpenAiCompatibleLlmClient } from '../../src/llm/openai-compatible-client/index.js';
import { buildIntentPrompt } from '../../src/llm/prompts.js';
import { text } from '../../src/locales/locale.js';
import { intentEvalFixtures } from '../intent-eval-fixtures.js';
import { parseEvalEnv } from './env.js';
import { filterFixtures, parseEvalFilters } from './filters.js';
import {
  createEvalLookupSources,
  matchesLookupExpectation
} from './lookup-context.js';
import { formatMarkdown, printResult } from './reporting.js';
import { evaluateRubric, hasRubricFailures } from './scoring.js';
import type { EvalResult } from './types.js';

export async function main(): Promise<number> {
  const env = parseEvalEnv(process.env);
  const client = new OpenAI({
    apiKey: env.llmApiKey,
    baseURL: env.llmBaseUrl,
    timeout: 45_000,
    maxRetries: 0
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
    const prompt =
      fixture.intent === 'answer'
        ? ''
        : buildIntentPrompt({ ...fixture, intent: fixture.intent });
    const answer =
      fixture.intent === 'answer' ? await evaluateAnswer(llm, fixture) : null;
    const response = answer
      ? answer.response
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
      prompt: answer?.prompt ?? prompt,
      response,
      rubric: evaluateRubric(response, fixture.rubric),
      ...(answer ? { conversation: answer.conversation } : {})
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

  if (
    results.some(
      (result) =>
        hasRubricFailures(result.rubric) ||
        result.conversation?.passed === false
    )
  ) {
    process.exitCode = 1;
    console.error('One or more rubric checks failed.');
  }

  return typeof process.exitCode === 'number' ? process.exitCode : 0;
}

async function evaluateAnswer(
  llm: OpenAiCompatibleLlmClient,
  fixture: (typeof intentEvalFixtures)[number]
): Promise<{
  response: string;
  prompt: string;
  conversation: NonNullable<EvalResult['conversation']>;
}> {
  const input = {
    assistantInstructions: fixture.assistantInstructions,
    currentDateTime: fixture.currentDateTime,
    replyContext: fixture.replyContext,
    mediaContext: fixture.mediaContext ?? null
  };
  const prompts = [buildAnswerMessages(input)];
  const first = await llm.generateAnswer(input);
  const expectsLookup = fixture.lookupExpectation?.shouldLookup ?? false;

  if (first.decision.mode === 'grounded')
    throw new Error(`${fixture.id}: invalid preflight mode`);

  const selected = new Set(first.decision.context.messageIds);
  const expected = fixture.expectedMessageIds
    ? new Set(fixture.expectedMessageIds)
    : null;
  const relevantSelected = expected
    ? [...selected].filter((id) => expected.has(id)).length
    : 0;
  const contextPassed =
    expected === null ||
    (selected.size === expected.size && relevantSelected === expected.size);
  const conversation: NonNullable<EvalResult['conversation']> = {
    mode: first.decision.mode,
    selectedMessageIds: [...selected],
    contextPrecision: expected
      ? selected.size
        ? relevantSelected / selected.size
        : expected.size
          ? 0
          : 1
      : null,
    contextRecall: expected
      ? expected.size
        ? relevantSelected / expected.size
        : 1
      : null,
    passed:
      contextPassed &&
      (fixture.expectedMode
        ? first.decision.mode === fixture.expectedMode
        : (first.decision.mode === 'research') === expectsLookup),
    llmCalls: 1,
    promptTokensEstimate: first.promptTokensEstimate,
    latencyMs: first.latencyMs
  };

  if (first.decision.mode !== 'research')
    return {
      response: first.decision.text,
      prompt: JSON.stringify(prompts, null, 2),
      conversation
    };

  const researchPlan = first.decision;
  conversation.passed &&= matchesLookupExpectation(fixture, researchPlan);

  const sources = createEvalLookupSources(fixture);
  const groundedInput = {
    ...input,
    replyContext: selectAnswerContext(
      input.replyContext,
      first.decision.context.messageIds
    ),
    research: {
      plan: researchPlan,
      result: {
        queries: researchPlan.queries,
        sources: sources.map((source, index) => ({
          id: `web_${index + 1}`,
          query: researchPlan.queries[0] ?? '',
          ...source
        }))
      }
    }
  };
  prompts.push(buildAnswerMessages(groundedInput));
  const grounded = await llm.generateAnswer(groundedInput);

  if (grounded.decision.mode !== 'grounded') {
    throw new Error(`${fixture.id}: grounded answer was not returned`);
  }

  return {
    response: grounded.decision.text,
    prompt: JSON.stringify(prompts, null, 2),
    conversation: {
      ...conversation,
      llmCalls: 2,
      promptTokensEstimate:
        first.promptTokensEstimate + grounded.promptTokensEstimate,
      latencyMs: first.latencyMs + grounded.latencyMs
    }
  };
}
