import { describe, expect, test } from 'vitest';

import {
  decideReplyAction,
  detectDirectTrigger
} from '../src/domain/response-policy.js';

describe('detectDirectTrigger', () => {
  test.each([
    ['/explain', 'explain'],
    ['/summarize', 'summarize'],
    ['/decide', 'decide'],
    ['/describe', 'describe']
  ] as const)('returns %s command intent in groups', (commandText, intent) => {
    const trigger = detectDirectTrigger({
      botUserId: 77,
      botUsername: 'fun_bot',
      message: {
        chatType: 'group',
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
    ['/explain@fun_bot', 'explain'],
    ['/summarize@fun_bot', 'summarize'],
    ['/decide@fun_bot', 'decide'],
    ['/describe@fun_bot', 'describe']
  ] as const)('returns %s bot-suffixed command intent in groups', (commandText, intent) => {
    const trigger = detectDirectTrigger({
      botUserId: 77,
      botUsername: 'fun_bot',
      message: {
        chatType: 'group',
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

  test('returns none for commands addressed to another bot', () => {
    const trigger = detectDirectTrigger({
      botUserId: 77,
      botUsername: 'fun_bot',
      message: {
        chatType: 'group',
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
        chatType: 'group',
        text: 'эй, @fun_bot, расскажи что-нибудь',
        entities: [{ type: 'mention', offset: 4, length: 8 }],
        replyToUserId: null
      }
    });

    expect(trigger).toEqual({ kind: 'none' });
  });

  test.each([
    ['/explain', 'explain'],
    ['/summarize', 'summarize'],
    ['/decide', 'decide'],
    ['/describe', 'describe']
  ] as const)('returns %s command intent in private chats', (commandText, intent) => {
    const trigger = detectDirectTrigger({
      botUserId: 77,
      botUsername: 'fun_bot',
      message: {
        chatType: 'private',
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

  test('returns none for ordinary private text', () => {
    const trigger = detectDirectTrigger({
      botUserId: 77,
      botUsername: 'fun_bot',
      message: {
        chatType: 'private',
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
