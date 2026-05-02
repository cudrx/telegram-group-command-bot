import { describe, expect, test } from 'vitest';

import {
  decideReplyAction,
  detectDirectTrigger
} from '../src/domain/response-policy.js';

describe('detectDirectTrigger', () => {
  test.each([
    ['/summarize', 'summarize'],
    ['/decide', 'decide'],
    ['/read', 'read'],
    ['/answer', 'answer']
  ] as const)('returns %s command intent in chat mode', (commandText, intent) => {
    const trigger = detectDirectTrigger({
      botUserId: 77,
      botUsername: 'fun_bot',
      message: {
        authorizedMode: 'chat',
        text: `${commandText} ignored arguments`,
        entities: [
          { type: 'bot_command', offset: 0, length: commandText.length }
        ],
        replyToUserId: null
      }
    });

    expect(trigger).toEqual({
      kind: 'command',
      intent,
      commandText
    });
  });

  test.each([
    ['/summarize@fun_bot', 'summarize'],
    ['/decide@fun_bot', 'decide'],
    ['/read@fun_bot', 'read'],
    ['/answer@fun_bot', 'answer']
  ] as const)('returns %s bot-suffixed command intent in chat mode', (commandText, intent) => {
    const trigger = detectDirectTrigger({
      botUserId: 77,
      botUsername: 'fun_bot',
      message: {
        authorizedMode: 'chat',
        text: `${commandText} ignored arguments`,
        entities: [
          { type: 'bot_command', offset: 0, length: commandText.length }
        ],
        replyToUserId: null
      }
    });

    expect(trigger).toEqual({
      kind: 'command',
      intent,
      commandText
    });
  });

  test.each([
    '/explain',
    '/explain@fun_bot'
  ] as const)('returns none for removed %s command', (commandText) => {
    const trigger = detectDirectTrigger({
      botUserId: 77,
      botUsername: 'fun_bot',
      message: {
        authorizedMode: 'chat',
        text: `${commandText} ignored arguments`,
        entities: [
          { type: 'bot_command', offset: 0, length: commandText.length }
        ],
        replyToUserId: null
      }
    });

    expect(trigger).toEqual({ kind: 'none' });
  });

  test('returns none for commands addressed to another bot', () => {
    const trigger = detectDirectTrigger({
      botUserId: 77,
      botUsername: 'fun_bot',
      message: {
        authorizedMode: 'chat',
        text: '/decide@other_bot ignored arguments',
        entities: [
          {
            type: 'bot_command',
            offset: 0,
            length: '/decide@other_bot'.length
          }
        ],
        replyToUserId: null
      }
    });

    expect(trigger).toEqual({ kind: 'none' });
  });

  test('returns none for ordinary bot mentions', () => {
    const trigger = detectDirectTrigger({
      botUserId: 77,
      botUsername: 'fun_bot',
      message: {
        authorizedMode: 'chat',
        text: 'эй, @fun_bot, расскажи что-нибудь',
        entities: [{ type: 'mention', offset: 4, length: 8 }],
        replyToUserId: null
      }
    });

    expect(trigger).toEqual({ kind: 'none' });
  });

  test.each([
    '/summarize',
    '/decide',
    '/read',
    '/answer'
  ] as const)('returns none for %s command in private admin mode', (commandText) => {
    const trigger = detectDirectTrigger({
      botUserId: 77,
      botUsername: 'fun_bot',
      message: {
        authorizedMode: 'private_admin',
        text: `${commandText} ignored arguments`,
        entities: [
          { type: 'bot_command', offset: 0, length: commandText.length }
        ],
        replyToUserId: null
      }
    });

    expect(trigger).toEqual({ kind: 'none' });
  });

  test('returns weekly command intent in private admin mode', () => {
    const trigger = detectDirectTrigger({
      botUserId: 77,
      botUsername: 'fun_bot',
      message: {
        authorizedMode: 'private_admin',
        text: '/weekly',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }],
        replyToUserId: null
      }
    });

    expect(trigger).toEqual({
      kind: 'command',
      intent: 'weekly',
      commandText: '/weekly'
    });
  });

  test('returns none for /weekly in chat mode', () => {
    const trigger = detectDirectTrigger({
      botUserId: 77,
      botUsername: 'fun_bot',
      message: {
        authorizedMode: 'chat',
        text: '/weekly',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }],
        replyToUserId: null
      }
    });

    expect(trigger).toEqual({ kind: 'none' });
  });

  test('returns none for ordinary private admin text', () => {
    const trigger = detectDirectTrigger({
      botUserId: 77,
      botUsername: 'fun_bot',
      message: {
        authorizedMode: 'private_admin',
        text: 'обычное личное сообщение',
        entities: [],
        replyToUserId: null
      }
    });

    expect(trigger).toEqual({ kind: 'none' });
  });
});

describe('decideReplyAction', () => {
  test('replies to command triggers with their intent', () => {
    const decision = decideReplyAction({
      directTrigger: {
        kind: 'command',
        intent: 'decide',
        commandText: '/decide'
      }
    });

    expect(decision).toEqual({
      shouldReply: true,
      reason: 'command',
      intent: 'decide'
    });
  });

  test('ignores messages without a command trigger', () => {
    const decision = decideReplyAction({
      directTrigger: { kind: 'none' }
    });

    expect(decision).toEqual({
      shouldReply: false,
      reason: 'ignore'
    });
  });
});
