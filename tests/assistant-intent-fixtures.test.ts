import { describe, expect, test } from 'vitest';

import { intentEvalFixtures } from '../scripts/intent-eval-fixtures.js';
import { loadAssistantInstructions } from '../src/llm/prompt-files.js';

describe('intent eval fixtures', () => {
  test('has coverage for each command intent', () => {
    const coveredIntents = new Set(
      intentEvalFixtures.map((fixture) => fixture.intent)
    );

    expect(coveredIntents).toEqual(
      new Set(['answer', 'decide', 'summarize', 'translate'])
    );
    expect(intentEvalFixtures.map((fixture) => fixture.id)).toEqual([
      'answer-factual-question',
      'summarize-basic-discussion',
      'decide-basic-dispute',
      'translate-basic-message'
    ]);
  });

  test('reply-target fixtures use anchors instead of command arguments', () => {
    const replyTargetFixtures = intentEvalFixtures.filter(
      (fixture) => fixture.intent === 'answer' || fixture.intent === 'translate'
    );

    expect(replyTargetFixtures.length).toBeGreaterThan(0);

    for (const fixture of replyTargetFixtures) {
      expect(fixture.replyContext.replyAnchorMessage).not.toBe(null);
    }
  });

  test('all fixtures define deterministic rubric checks', () => {
    for (const fixture of intentEvalFixtures) {
      expect(fixture.rubric.mustIncludeAny.length).toBeGreaterThan(0);
      expect(fixture.rubric.mustNotIncludeAny.length).toBeGreaterThan(0);
      expect(
        [
          ...(fixture.rubric.mustIncludeAll ?? []),
          ...(fixture.rubric.mustMatchRegex ?? [])
        ].length
      ).toBeGreaterThan(0);
    }
  });

  test('lookup fixtures cover entity grounding expectations', () => {
    const lookupFixtures = intentEvalFixtures.filter(
      (fixture) => fixture.lookupExpectation
    );

    expect(lookupFixtures.map((fixture) => fixture.id)).toEqual([
      'answer-factual-question'
    ]);
    expect(lookupFixtures[0]?.lookupExpectation).toMatchObject({
      purpose: 'entity_grounding',
      includeTerms: ['Владимир Путин']
    });
  });

  test('fixtures use production assistant instructions by default', () => {
    const productionInstructions = loadAssistantInstructions();

    for (const fixture of intentEvalFixtures) {
      expect(fixture.assistantInstructions).toBe(productionInstructions);
    }
  });
});
