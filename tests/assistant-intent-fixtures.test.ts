import type { Context } from 'grammy';
import { describe, expect, test } from 'vitest';
import { createFixture } from '../scripts/intent-eval-fixtures/factory.js';
import { intentEvalFixtures } from '../scripts/intent-eval-fixtures.js';
import { hasAssistantMention } from '../src/app/assistant-mention.js';
import { buildAnswerMessages } from '../src/llm/openai-compatible-client/answer.js';
import { estimateTokens } from '../src/llm/openai-compatible-client/logging.js';
import { loadAssistantInstructions } from '../src/llm/prompt-files.js';
import { normalizeTextMessage } from '../src/transport/telegram/normalize-message.js';

describe('intent eval fixtures', () => {
  test('avatar scenario invokes the assistant while replying to a participant', () => {
    const fixture = intentEvalFixtures.find(
      (item) => item.id === 'social-context-bot-avatar'
    );
    const trigger = fixture?.replyContext.triggerMessage;
    const target = fixture?.replyContext.replyAnchorMessage;
    if (!trigger || !target) throw new Error('Missing avatar conversation');

    const offset = trigger.text.indexOf('@hrupa_bot');
    const message = normalizeTextMessage({
      message: {
        message_id: trigger.messageId,
        date: 1,
        chat: { id: trigger.chatId, type: 'group' },
        from: {
          id: trigger.userId,
          is_bot: false,
          first_name: trigger.senderDisplayName
        },
        text: trigger.text,
        entities: offset >= 0 ? [{ type: 'mention', offset, length: 10 }] : [],
        reply_to_message: {
          message_id: target.messageId,
          date: 1,
          chat: { id: target.chatId, type: 'group' },
          from: {
            id: target.userId,
            is_bot: target.isBot,
            first_name: target.senderDisplayName
          },
          text: target.text
        }
      }
    } as Context);
    if (!message) throw new Error('Failed to normalize fixture trigger');

    expect(message.replyToUserId).not.toBe(77);
    expect(message.replyToMessageId).toBe(4);
    expect(hasAssistantMention(message, 'hrupa_bot')).toBe(true);
  });

  test('preserves the requesting participant identity and places the trigger after history', () => {
    const fixture = createFixture({
      id: 'identity-regression',
      intent: 'answer',
      targetDisplayName: 'Алиса',
      rows: [['2026-10-27T10:00:00Z', 'Алиса', 'Предыдущий вопрос']],
      triggerText: '@bot продолжим',
      rubric: { mustIncludeAny: [], mustNotIncludeAny: [] }
    });
    const previous = fixture.replyContext.priorContextMessages[0];
    const trigger = fixture.replyContext.triggerMessage;

    expect(trigger?.userId).toBe(previous?.userId);
    expect(Date.parse(trigger?.createdAt ?? '')).toBeGreaterThan(
      Date.parse(previous?.createdAt ?? '')
    );
  });

  test('reuses an existing reply target instead of duplicating its text', () => {
    const fixture = createFixture({
      id: 'anchor-regression',
      intent: 'answer',
      targetDisplayName: 'Алиса',
      rows: [['2026-10-27T10:00:00Z', 'Борис', 'Уникальный вопрос']],
      triggerText: '@bot',
      replyAnchorText: 'Уникальный вопрос',
      rubric: { mustIncludeAny: [], mustNotIncludeAny: [] }
    });

    expect(fixture.replyContext.triggerMessage?.replyToMessageId).toBe(1);
    expect(fixture.replyContext.replyAnchorMessage?.senderDisplayName).toBe(
      'Борис'
    );
    expect(fixture.replyContext.priorContextMessages).toEqual([]);
  });

  test('retains semantic criteria and length limits in the shared fixture set', () => {
    const fixture = intentEvalFixtures.find(
      (item) => item.id === 'social-memory-no-reply'
    );

    expect(fixture).toHaveProperty('evaluation.requiredBotMessageIds', [2]);
    expect(fixture).toHaveProperty('evaluation.maxResponseChars', 150);
    expect(fixture).toHaveProperty('evaluation.criteria', expect.any(String));
    if (!fixture?.evaluation) throw new Error('Missing evaluation');
    expect(
      buildAnswerMessages(fixture)
        .map((message) => message.content)
        .join('\n')
    ).not.toContain(fixture.evaluation.criteria);
  });
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
      expect(Object.values(fixture.rubric).flat().length).toBeGreaterThan(0);
    }
  });

  test('lookup fixtures cover freshness and explicit slang verification with evidence', () => {
    const lookupFixtures = intentEvalFixtures.filter(
      (fixture) => fixture.lookupExpectation?.shouldLookup
    );

    expect(lookupFixtures.map((fixture) => fixture.id)).toEqual([
      'answer-research-unfamiliar-slang',
      'answer-research-current-release'
    ]);
    expect(lookupFixtures[0]?.lookupExpectation).toMatchObject({
      purpose: 'entity_grounding',
      includeAnyTerms: ['гунер', 'gooner']
    });
    expect(lookupFixtures[1]?.lookupExpectation).toMatchObject({
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
