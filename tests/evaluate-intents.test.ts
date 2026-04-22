import { describe, expect, test } from 'vitest';

import {
  createEvalLookupContext,
  evaluateRubric,
  filterFixtures,
  hasRubricFailures
} from '../scripts/evaluate-intents.js';
import { intentEvalFixtures } from '../scripts/intent-eval-fixtures.js';

describe('evaluate-intents helpers', () => {
  test('treats read regressions as rubric failures', () => {
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
      (candidate) => candidate.id === 'answer-factual-question'
    );

    expect(fixture).toBeDefined();

    if (!fixture) {
      throw new Error('Expected answer-factual-question fixture to exist.');
    }

    const lookupContext = createEvalLookupContext(fixture);

    expect(lookupContext).toMatchObject({
      status: 'used',
      provider: 'tavily',
      intent: 'answer',
      decision: {
        shouldLookup: true,
        purpose: 'entity_grounding'
      }
    });
    expect(lookupContext?.sources.map((source) => source.title)).toContain(
      'Владимир Путин'
    );
    expect(lookupContext?.decision.queries).toEqual(['Владимир Путин']);
    expect(lookupContext?.sources.at(-1)?.content).toContain('Владимир Путин');
  });

  test('filters eval fixtures by id and intent', () => {
    expect(
      filterFixtures(intentEvalFixtures, {
        ids: new Set(['read-audio-transcript']),
        intents: new Set()
      }).map((fixture) => fixture.id)
    ).toEqual(['read-audio-transcript']);

    expect(
      filterFixtures(intentEvalFixtures, {
        ids: new Set(),
        intents: new Set(['read'])
      }).map((fixture) => fixture.intent)
    ).toEqual(['read', 'read', 'read']);
  });
});
