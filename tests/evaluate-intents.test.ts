import { describe, expect, test } from 'vitest';
import { formatMarkdown } from '../scripts/evaluate-intents/reporting.js';
import {
  evaluateFixtureChecks,
  getEvalStatus
} from '../scripts/evaluate-intents/scoring.js';
import {
  createEvalLookupSources,
  evaluateRubric,
  filterFixtures,
  hasRubricFailures,
  matchesLookupExpectation,
  parseEvalEnv
} from '../scripts/evaluate-intents.js';
import { intentEvalFixtures } from '../scripts/intent-eval-fixtures.js';
import { buildAnswerMessages } from '../src/llm/openai-compatible-client/answer.js';

describe('evaluate-intents helpers', () => {
  test.each([
    [
      'answer-research-unfamiliar-slang',
      'Гунер — интернет-сленг о чрезмерном увлечении порнографией; слово не означает стрелка.'
    ],
    [
      'social-truth-cost-agreement',
      'Полностью согласен, что интеллектуально оценивать уместность сложно. Стоимость зависит от реализации: редкие проверки по простым правилам могут быть недорогими.'
    ]
  ])('leaves a valid answer for semantic review without a false lexical failure: %s', (id, response) => {
    const fixture = intentEvalFixtures.find((item) => item.id === id);
    if (!fixture) throw new Error(`Missing fixture ${id}`);

    const result = {
      id,
      intent: fixture.intent,
      prompt: '',
      response,
      rubric: evaluateRubric(response, fixture.rubric),
      evaluation: evaluateFixtureChecks(
        fixture,
        response,
        buildAnswerMessages(fixture)
      )
    };
    expect(hasRubricFailures(result.rubric)).toBe(false);
    expect(getEvalStatus(result)).toBe('needs_review');
  });

  test.each([
    [
      'answer-research-unfamiliar-slang',
      'Гунер — это стрелок, увлекающийся порнографией.'
    ],
    ['social-truth-cost-agreement', 'Полностью согласен, спорить не с чем.']
  ])('does not automatically approve an incorrect meaning or empty agreement: %s', (id, response) => {
    const fixture = intentEvalFixtures.find((item) => item.id === id);
    if (!fixture) throw new Error(`Missing fixture ${id}`);

    expect(
      getEvalStatus({
        id,
        intent: fixture.intent,
        prompt: '',
        response,
        rubric: evaluateRubric(response, fixture.rubric),
        evaluation: evaluateFixtureChecks(
          fixture,
          response,
          buildAnswerMessages(fixture)
        )
      })
    ).not.toBe('passed');
  });

  test('enforces social length and checks bot history in the fitted prompt', () => {
    const fixture = intentEvalFixtures.find(
      (item) => item.id === 'social-memory-no-reply'
    );
    if (!fixture) throw new Error('Missing memory scenario');

    const fitted = buildAnswerMessages(fixture);
    expect(
      evaluateFixtureChecks(fixture, '«Тихие кометы»', fitted)
    ).toMatchObject({
      length: { passed: true },
      botContext: { passed: true, missingIds: [] },
      semantic: { status: 'pending' }
    });
    // The fixture still has its history; only the actual model input lacks it.
    const missing = evaluateFixtureChecks(fixture, 'x'.repeat(151), []);
    expect(missing).toMatchObject({
      length: { passed: false, actual: 151, max: 150 },
      botContext: { passed: false, missingIds: [2] }
    });
    const wrongActor = fitted.map((message) => ({
      ...message,
      content: message.content.replaceAll('actor=bot ', 'actor=user#77 ')
    }));
    expect(
      evaluateFixtureChecks(fixture, '«Тихие кометы»', wrongActor)?.botContext
    ).toMatchObject({ passed: false, missingIds: [2] });
  });

  test.each([
    [
      'social-opinion-familiar-options',
      'Кот и капибара оба замечательные, поэтому выбирать не стану.'
    ],
    [
      'social-joke-recognized-but-blocked',
      'Я понимаю, что это шутка, но нужны доказательства полномочий кота.'
    ]
  ])('does not award a semantic pass to a lexical match: %s', (id, response) => {
    const fixture = intentEvalFixtures.find((item) => item.id === id);
    if (!fixture) throw new Error('Missing choice scenario');

    const result = {
      id: fixture.id,
      intent: fixture.intent,
      prompt: '',
      response,
      rubric: evaluateRubric(response, fixture.rubric),
      evaluation: evaluateFixtureChecks(
        fixture,
        response,
        buildAnswerMessages(fixture)
      )
    };
    expect(getEvalStatus(result)).toBe('needs_review');
    expect(formatMarkdown([result])).toContain('NEEDS_REVIEW');
    expect(formatMarkdown([result])).toContain(fixture.evaluation?.criteria);
    if (!result.evaluation) throw new Error('Missing evaluation');
    result.evaluation.semantic.status = 'failed';
    expect(getEvalStatus(result)).toBe('failed');
  });

  test('accepts playful wording containing a literal inability phrase', () => {
    const fixture = intentEvalFixtures.find(
      (item) => item.id === 'social-joke-cat-director'
    );
    if (!fixture) throw new Error('Missing director scenario');

    expect(
      hasRubricFailures(
        evaluateRubric(
          'Не могу спорить с директором, особенно когда он требует премию кормом.',
          fixture.rubric
        )
      )
    ).toBe(false);
  });

  test('requires every positive group and excludes every forbidden term', () => {
    const rubric = {
      mustIncludeAny: [
        ['кот', 'капибара'],
        ['выбираю', 'мой выбор']
      ],
      mustNotIncludeAny: [['данных нет', 'не стану']]
    };
    expect(hasRubricFailures(evaluateRubric('кот и капибара', rubric))).toBe(
      true
    );
    expect(hasRubricFailures(evaluateRubric('выбираю кота', rubric))).toBe(
      false
    );
    expect(
      hasRubricFailures(
        evaluateRubric('мой выбор кот, но выбирать не стану', rubric)
      )
    ).toBe(true);
  });
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

  test('accepts either spelling of the slang in research queries', () => {
    const fixture = intentEvalFixtures.find(
      (item) => item.id === 'answer-research-unfamiliar-slang'
    );
    if (!fixture) throw new Error('Missing slang scenario');

    for (const query of [
      'гунер значение сленг',
      'gooner internet slang meaning'
    ]) {
      expect(
        matchesLookupExpectation(fixture, {
          purpose: 'entity_grounding',
          queries: [query]
        })
      ).toBe(true);
    }
    expect(
      matchesLookupExpectation(fixture, {
        purpose: 'entity_grounding',
        queries: ['anime definition']
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
