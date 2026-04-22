import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

import { intentEvalFixtures } from '../scripts/intent-eval-fixtures.js';
import { buildIntentPrompt } from '../src/llm/prompts.js';

describe('intent eval fixtures', () => {
  test('has coverage for each command intent', () => {
    const coveredIntents = new Set(
      intentEvalFixtures.map((fixture) => fixture.intent)
    );

    expect(coveredIntents).toEqual(
      new Set(['answer', 'decide', 'explain', 'read', 'summarize'])
    );
    expect(intentEvalFixtures.map((fixture) => fixture.id)).toEqual([
      'read-vision-meme',
      'read-ocr-image-receipt',
      'read-audio-transcript',
      'answer-factual-question',
      'explain-factual-question-meaning',
      'summarize-basic-discussion',
      'decide-basic-dispute'
    ]);
  });

  test('all fixtures build prompts with their selected mode', () => {
    for (const fixture of intentEvalFixtures) {
      const prompt = buildIntentPrompt(fixture);

      expect(prompt).toContain(`The selected task mode is: ${fixture.intent}`);
      expect(prompt).toContain('BEGIN CHAT TRANSCRIPT');
      expect(prompt).toContain('END CHAT TRANSCRIPT');
    }
  });

  test('reply-target fixtures use anchors instead of command arguments', () => {
    const replyTargetFixtures = intentEvalFixtures.filter(
      (fixture) => fixture.intent === 'explain' || fixture.intent === 'answer'
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
    const productionInstructions = readFileSync(
      'llm/assistant/base.md',
      'utf8'
    ).trim();

    for (const fixture of intentEvalFixtures) {
      expect(fixture.assistantInstructions).toBe(productionInstructions);
    }
  });

  test('explain fixtures do not require redirecting to another command', () => {
    const explainFixtures = intentEvalFixtures.filter(
      (fixture) => fixture.intent === 'explain'
    );

    for (const fixture of explainFixtures) {
      const includeTerms = fixture.rubric.mustIncludeAny.flat();

      expect(includeTerms).not.toContain('/decide');
      expect(includeTerms).not.toContain('decide');
    }
  });
});
