import { describe, expect, test } from 'vitest';
import { intentEvalFixtures } from '../scripts/intent-eval-fixtures.js';
import { buildAnswerMessages } from '../src/llm/openai-compatible-client/answer.js';
import { estimateTokens } from '../src/llm/openai-compatible-client/logging.js';
import { loadAssistantInstructions } from '../src/llm/prompt-files.js';

describe('intent eval fixtures', () => {
  test('covers the assistant and LLM utility scenarios', () => {
    const coveredIntents = new Set(
      intentEvalFixtures.map((fixture) => fixture.intent)
    );

    expect(coveredIntents).toEqual(new Set(['answer', 'translate', 'read']));
    expect(intentEvalFixtures.map((fixture) => fixture.id)).toEqual(
      expect.arrayContaining([
        'answer-factual-question',
        'answer-does-not-mirror-hostility',
        'summarize-basic-discussion',
        'decide-basic-dispute',
        'decide-two-sided-dispute',
        'translate-basic-message',
        'read-preserves-source-language',
        'conversation-parallel-topics',
        'conversation-missing-subject',
        'conversation-old-reply-chain',
        'conversation-scam-slang',
        'conversation-corrects-own-answer',
        'conversation-reply-to-clarification',
        'conversation-injection-is-data'
      ])
    );
  });

  test('reply-target fixtures use anchors instead of command arguments', () => {
    const replyTargetFixtures = intentEvalFixtures.filter(
      (fixture) => fixture.intent === 'translate'
    );

    expect(replyTargetFixtures.length).toBeGreaterThan(0);

    for (const fixture of replyTargetFixtures) {
      expect(fixture.replyContext.replyAnchorMessage).not.toBe(null);
    }
  });

  test.each([
    'conversation-media-priority',
    'conversation-audio-budget'
  ])('keeps the required evidence within the full prompt budget: %s', (id) => {
    const fixture = intentEvalFixtures.find((fixture) => fixture.id === id);
    if (!fixture) throw new Error(`Missing fixture ${id}`);

    const messages = buildAnswerMessages(fixture);
    expect(
      estimateTokens(messages.map((message) => message.content).join('\n\n'))
    ).toBeLessThanOrEqual(16000);
    expect(messages[1]?.content).toContain('contextTruncated=true');
    if (id === 'conversation-media-priority')
      expect(messages[1]?.content).toContain('messageId=1 ');
    else
      expect(messages[1]?.content).toContain('сколько будет семь плюс восемь');
  });

  test('all fixtures define deterministic rubric checks', () => {
    for (const fixture of intentEvalFixtures) {
      expect(fixture.rubric.mustIncludeAny.length).toBeGreaterThan(0);
      expect(fixture.rubric.mustNotIncludeAny.length).toBeGreaterThan(0);
    }
  });

  test('lookup fixtures cover freshness with explicit release evidence', () => {
    const lookupFixtures = intentEvalFixtures.filter(
      (fixture) => fixture.lookupExpectation?.shouldLookup
    );

    expect(lookupFixtures.map((fixture) => fixture.id)).toEqual([
      'answer-research-current-release'
    ]);
    expect(lookupFixtures[0]?.lookupExpectation).toMatchObject({
      purpose: 'freshness',
      includeTerms: ['Auroralab Ledger']
    });
  });

  test('fixtures use production assistant instructions by default', () => {
    const productionInstructions = loadAssistantInstructions();

    for (const fixture of intentEvalFixtures) {
      expect(fixture.assistantInstructions).toBe(productionInstructions);
    }
  });
});
