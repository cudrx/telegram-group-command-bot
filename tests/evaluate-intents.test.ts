import { describe, expect, test } from 'vitest';

import {
  createEvalLookupSources,
  evaluateRubric,
  filterFixtures,
  hasRubricFailures,
  matchesLookupExpectation,
  parseEvalEnv
} from '../scripts/evaluate-intents.js';
import { intentEvalFixtures } from '../scripts/intent-eval-fixtures.js';

describe('evaluate-intents helpers', () => {
  test('rejects a correct number accompanied by a false denial of the previous bot error', () => {
    const fixture = intentEvalFixtures.find(
      (item) => item.id === 'social-truth-correct-own-error'
    );
    if (!fixture) throw new Error('Missing correction scenario');

    expect(
      hasRubricFailures(
        evaluateRubric(
          'Нет, ошибки не было: правильный ответ — 323.',
          fixture.rubric
        )
      )
    ).toBe(true);
    expect(
      hasRubricFailures(
        evaluateRubric('Да, ошибся: 17 × 19 = 323.', fixture.rubric)
      )
    ).toBe(false);
  });

  test('accepts correct claim attribution with inflected participant names', () => {
    const fixture = intentEvalFixtures.find(
      (item) => item.id === 'social-intent-report-claims'
    );
    if (!fixture) throw new Error('Missing attribution scenario');

    expect(
      hasRubricFailures(
        evaluateRubric(
          'По сообщению Алисы, Борис назвал 19:00; Вера — 20:00.',
          fixture.rubric
        )
      )
    ).toBe(false);
  });

  test('treats rubric regressions as failures', () => {
    const rubric = {
      mustIncludeAny: [['через десять']],
      mustIncludeAll: [],
      mustMatchRegex: ['[\\s\\S]+'],
      mustNotIncludeAny: [['думаю'], ['это значит']],
      mustNotMatchRegex: ['^\\s*•']
    };

    const result = evaluateRubric('• думаю, это значит он опоздает', rubric);

    expect(result.exclude.every((check) => check.passed)).toBe(false);
    expect(result.include.every((check) => check.passed)).toBe(false);
    expect(result.notMatchRegex.every((check) => check.passed)).toBe(false);
    expect(hasRubricFailures(result)).toBe(true);
  });

  test('adds fixture lookup context for lookup-backed eval cases', () => {
    const fixture = intentEvalFixtures.find(
      (candidate) => candidate.id === 'answer-research-current-release'
    );

    expect(fixture).toBeDefined();

    if (!fixture) {
      throw new Error(
        'Expected answer-research-current-release fixture to exist.'
      );
    }

    const sources = createEvalLookupSources(fixture);
    expect(sources.map((source) => source.title)).toContain(
      'Auroralab Ledger release notes'
    );
    expect(sources.at(-1)?.content).toContain('4.2.1');
    expect(
      matchesLookupExpectation(fixture, {
        purpose: 'freshness',
        queries: ['Auroralab Ledger latest stable release']
      })
    ).toBe(true);
    expect(
      matchesLookupExpectation(fixture, {
        purpose: 'freshness',
        queries: ['other product']
      })
    ).toBe(false);
    expect(
      matchesLookupExpectation(fixture, {
        purpose: 'fact_check',
        queries: ['Auroralab Ledger']
      })
    ).toBe(false);
  });

  test('filters eval fixtures by id and intent', () => {
    expect(
      filterFixtures(intentEvalFixtures, {
        ids: new Set(['summarize-basic-discussion']),
        intents: new Set()
      }).map((fixture) => fixture.id)
    ).toEqual(['summarize-basic-discussion']);

    expect(
      filterFixtures(intentEvalFixtures, {
        ids: new Set(),
        intents: new Set(['translate'])
      }).map((fixture) => fixture.intent)
    ).toEqual(['translate']);
  });

  test('parses only LLM settings for eval runs', () => {
    const env = parseEvalEnv({
      LLM_API_KEY: 'llm-key',
      LLM_BASE_URL: 'https://llm.example/v1',
      LLM_REPLY_MODEL: 'reply-model',
      LLM_REPLY_TEMPERATURE: '0.2'
    });

    expect(env).toEqual({
      llmApiKey: 'llm-key',
      llmBaseUrl: 'https://llm.example/v1',
      llmReplyModel: 'reply-model',
      llmReplyTemperature: 0.2
    });
  });
});
