import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import {
  buildLookupPlannerPrompt,
  parseLookupDecision
} from '../src/llm/lookup-planner.js';

const replyContext = {
  triggerMessage: {
    chatId: 1,
    messageId: 3,
    userId: 42,
    senderDisplayName: 'Tom',
    text: '/decide',
    createdAt: '2026-04-17T20:13:00.000Z',
    isBot: false,
    replyToMessageId: null
  },
  replyAnchorMessage: null,
  priorContextMessages: [
    {
      chatId: 1,
      messageId: 1,
      userId: 1,
      senderDisplayName: 'Артём',
      text: 'кто лучше дора или мейби бэйби?',
      createdAt: '2026-04-17T20:10:00.000Z',
      isBot: false,
      replyToMessageId: null
    }
  ]
};

describe('buildLookupPlannerPrompt', () => {
  test('keeps static lookup planner prompt text in llm markdown files', () => {
    expect(readFileSync('llm/planner/lookup.md', 'utf8')).toContain(
      'You are a Telegram lookup planner.'
    );
  });

  test('biases decide planning toward entity grounding when references may be misunderstood', () => {
    const prompt = buildLookupPlannerPrompt({
      intent: 'decide',
      replyContext
    });

    expect(prompt).toContain(
      'Always decide whether external lookup is useful for this command.'
    );
    expect(prompt).toContain('When uncertain, choose lookup.');
    expect(prompt).toContain('entity_grounding');
    expect(prompt).toContain('дора');
    expect(prompt).toContain('мейби');
    expect(prompt).toContain('Return only minified JSON');
  });
});

describe('parseLookupDecision', () => {
  test('parses and clamps a usable lookup decision', () => {
    expect(
      parseLookupDecision(
        '{"shouldLookup":true,"purpose":"entity_grounding","reason":"Need to know who Dora and Maybe Baby are.","queries":["Дора Мэйби Бэйби певицы кто такие","unused"],"confidence":"medium"}',
        1
      )
    ).toEqual({
      shouldLookup: true,
      purpose: 'entity_grounding',
      reason: 'Need to know who Dora and Maybe Baby are.',
      queries: ['Дора Мэйби Бэйби певицы кто такие'],
      confidence: 'medium'
    });
  });

  test('returns a safe skip decision for invalid JSON', () => {
    expect(parseLookupDecision('not json', 1)).toEqual({
      shouldLookup: false,
      purpose: 'none',
      reason: 'Lookup planner returned invalid JSON.',
      queries: [],
      confidence: 'low'
    });
  });

  test('forces skip when shouldLookup is true but no query exists', () => {
    expect(
      parseLookupDecision(
        '{"shouldLookup":true,"purpose":"fact_check","reason":"Need facts.","queries":[],"confidence":"high"}',
        1
      )
    ).toEqual({
      shouldLookup: false,
      purpose: 'none',
      reason: 'Lookup planner requested lookup without a query.',
      queries: [],
      confidence: 'low'
    });
  });
});
