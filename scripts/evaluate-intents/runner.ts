import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import OpenAI from 'openai';
import {
  buildAnswerMessages,
  type GenerateAnswerInput,
  getSelectedMessageIds
} from '../../src/llm/openai-compatible-client/answer.js';
import { OpenAiCompatibleLlmClient } from '../../src/llm/openai-compatible-client/index.js';
import { buildIntentPrompt } from '../../src/llm/prompts.js';
import { text } from '../../src/locales/locale.js';
import { intentEvalFixtures } from '../intent-eval-fixtures.js';
import { type EvalEnv, parseEvalEnv } from './env.js';
import { filterFixtures, parseEvalFilters } from './filters.js';
import {
  createEvalLookupSources,
  matchesLookupExpectation
} from './lookup-context.js';
import { formatMarkdown, printResult } from './reporting.js';
import {
  evaluateFixtureChecks,
  evaluateRubric,
  getEvalStatus
} from './scoring.js';
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
    const result = await evaluateFixture(client, llm, fixture, env);

    results.push(result);
    printResult(result);
    await writeFile(
      path.join(outputDir, 'assistant-intents.json'),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          settings: {
            model: env.llmReplyModel,
            temperature: env.llmReplyTemperature,
            timeoutMs: 45_000,
            maxRetries: 0
          },
          results
        },
        null,
        2
      ),
      'utf8'
    );
    await writeFile(
      path.join(outputDir, 'assistant-intents.md'),
      formatMarkdown(results),
      'utf8'
    );
  }

  console.log('');
  console.log(`Saved eval results to ${outputDir}`);
  const categories = [
    ...new Set(
      results.map((result) => result.evaluation?.category ?? result.intent)
    )
  ];
  for (const category of categories) {
    const group = results.filter(
      (result) => (result.evaluation?.category ?? result.intent) === category
    );
    console.log(
      JSON.stringify({
        category,
        total: group.length,
        failed: group.filter((result) => getEvalStatus(result) === 'failed')
          .length,
        needsReview: group.filter(
          (result) => getEvalStatus(result) === 'needs_review'
        ).length,
        passed: group.filter((result) => getEvalStatus(result) === 'passed')
          .length
      })
    );
  }

  if (results.some((result) => getEvalStatus(result) === 'failed')) {
    process.exitCode = 1;
    console.error('One or more eval fixtures failed.');
  }

  return typeof process.exitCode === 'number' ? process.exitCode : 0;
}

export async function evaluateFixture(
  client: OpenAI,
  llm: OpenAiCompatibleLlmClient,
  fixture: (typeof intentEvalFixtures)[number],
  env: Pick<EvalEnv, 'llmReplyModel' | 'llmReplyTemperature'>
): Promise<EvalResult> {
  try {
    const prompt =
      fixture.intent === 'answer'
        ? ''
        : buildIntentPrompt({ ...fixture, intent: fixture.intent });
    const answer =
      fixture.intent === 'answer' ? await evaluateAnswer(llm, fixture) : null;
    let response: string;
    if (answer) {
      response = answer.response;
    } else {
      const completion = await client.chat.completions.create({
        model: env.llmReplyModel,
        temperature: env.llmReplyTemperature,
        messages: [
          { role: 'system', content: text.llm.evalSystem },
          { role: 'user', content: prompt }
        ]
      });
      response = completion.choices[0]?.message.content?.trim() ?? '';
    }

    return {
      id: fixture.id,
      intent: fixture.intent,
      prompt: answer?.prompt ?? prompt,
      response,
      rubric: evaluateRubric(response, fixture.rubric),
      evaluation: evaluateFixtureChecks(
        fixture,
        response,
        answer?.fittedMessages ?? []
      ),
      ...(answer ? { conversation: answer.conversation } : {})
    };
  } catch (error) {
    return {
      id: fixture.id,
      intent: fixture.intent,
      prompt: '',
      response: '',
      rubric: evaluateRubric('', fixture.rubric),
      error:
        error instanceof Error
          ? { name: error.name, message: error.message }
          : { name: 'Error', message: String(error) }
    };
  }
}

export async function evaluateAnswer(
  llm: OpenAiCompatibleLlmClient,
  fixture: (typeof intentEvalFixtures)[number]
): Promise<{
  response: string;
  prompt: string;
  fittedMessages: ReturnType<typeof buildAnswerMessages>;
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

  if (!('discussions' in first.decision))
    throw new Error(`${fixture.id}: invalid preflight mode`);

  const selected = new Set(getSelectedMessageIds(first.decision));
  const expected = fixture.expectedMessageIds
    ? new Set(fixture.expectedMessageIds)
    : null;
  const relevantSelected = expected
    ? [...selected].filter((id) => expected.has(id)).length
    : 0;
  const contextPassed =
    expected === null ||
    (selected.size === expected.size && relevantSelected === expected.size);
  const plan = first.decision;
  const discussionsPassed = (fixture.expectedDiscussions ?? []).every(
    (expectedIds) =>
      plan.discussions.some(
        (discussion) =>
          discussion.messageIds.length === expectedIds.length &&
          expectedIds.every((id) => discussion.messageIds.includes(id))
      )
  );
  const inferredLinksPassed = (fixture.expectedInferredLinks ?? []).every(
    (expectedLink) =>
      plan.inferredLinks.some(
        (link) => link.from === expectedLink.from && link.to === expectedLink.to
      )
  );
  const graphPassed = discussionsPassed && inferredLinksPassed;
  let contextPrecision: number | null = null;
  let contextRecall: number | null = null;
  if (expected) {
    contextPrecision = 1;
    contextRecall = 1;
    if (selected.size > 0) {
      contextPrecision = relevantSelected / selected.size;
    } else if (expected.size > 0) {
      contextPrecision = 0;
    }
    if (expected.size > 0) contextRecall = relevantSelected / expected.size;
  }

  const conversation: NonNullable<EvalResult['conversation']> = {
    mode: first.decision.mode,
    discussions: plan.discussions,
    inferredLinks: plan.inferredLinks,
    graphPassed,
    selectedMessageIds: [...selected],
    contextPrecision,
    contextRecall,
    passed:
      contextPassed &&
      graphPassed &&
      (fixture.expectedMode
        ? first.decision.mode === fixture.expectedMode
        : (first.decision.mode === 'research') === expectsLookup),
    llmCalls: first.attemptCount,
    promptTokensEstimate: first.promptTokensEstimate,
    latencyMs: first.latencyMs
  };

  let finalInput: GenerateAnswerInput = { ...input, plan };
  if (plan.mode === 'research') {
    const { resolvedQuestion, purpose, focusClaim, queries } = plan;
    const researchPlan = { resolvedQuestion, purpose, focusClaim, queries };
    conversation.passed &&= matchesLookupExpectation(fixture, researchPlan);
    finalInput = {
      ...finalInput,
      research: {
        plan: researchPlan,
        result: {
          queries,
          sources: createEvalLookupSources(fixture).map((source, index) => ({
            id: `web_${index + 1}`,
            query: queries[0] ?? '',
            ...source
          }))
        }
      }
    };
  }
  prompts.push(buildAnswerMessages(finalInput));
  const final = await llm.generateAnswer(finalInput);
  if (!('text' in final.decision))
    throw new Error(`${fixture.id}: final answer was not returned`);

  return {
    response: final.decision.text,
    prompt: JSON.stringify(prompts, null, 2),
    fittedMessages: prompts.at(-1) ?? [],
    conversation: {
      ...conversation,
      llmCalls: first.attemptCount + final.attemptCount,
      promptTokensEstimate:
        first.promptTokensEstimate + final.promptTokensEstimate,
      latencyMs: first.latencyMs + final.latencyMs
    }
  };
}
