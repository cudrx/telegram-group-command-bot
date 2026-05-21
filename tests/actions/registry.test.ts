import { describe, expect, test } from 'vitest';
import { chatActionRegistry } from '../../src/app/actions/index.js';
import { createActionRegistry } from '../../src/app/actions/registry.js';
import type { ChatAction } from '../../src/app/actions/types.js';

function action(
  input: Pick<ChatAction, 'intent' | 'commands' | 'modes'>
): ChatAction {
  return {
    ...input,
    async handle() {}
  };
}

describe('createActionRegistry', () => {
  test('resolves chat commands from action metadata', () => {
    const registry = createActionRegistry([
      action({
        intent: 'answer',
        commands: ['answer'],
        modes: ['chat']
      })
    ]);

    expect(
      registry.resolveCommand({
        botUsername: 'fun_bot',
        mode: 'chat',
        text: '/answer ignored arguments',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }]
      })
    ).toMatchObject({
      action: expect.objectContaining({ intent: 'answer' }),
      commandText: '/answer'
    });
  });

  test('resolves commands addressed to this bot', () => {
    const registry = createActionRegistry([
      action({
        intent: 'meme',
        commands: ['meme'],
        modes: ['chat']
      })
    ]);

    expect(
      registry.resolveCommand({
        botUsername: 'fun_bot',
        mode: 'chat',
        text: '/meme@fun_bot',
        entities: [{ type: 'bot_command', offset: 0, length: 13 }]
      })
    ).toMatchObject({
      action: expect.objectContaining({ intent: 'meme' }),
      commandText: '/meme@fun_bot'
    });
  });

  test('ignores commands addressed to another bot', () => {
    const registry = createActionRegistry([
      action({
        intent: 'decide',
        commands: ['decide'],
        modes: ['chat']
      })
    ]);

    expect(
      registry.resolveCommand({
        botUsername: 'fun_bot',
        mode: 'chat',
        text: '/decide@other_bot ignored arguments',
        entities: [{ type: 'bot_command', offset: 0, length: 17 }]
      })
    ).toBeNull();
  });

  test('ignores commands in unsupported modes', () => {
    const registry = createActionRegistry([
      action({
        intent: 'read',
        commands: ['read'],
        modes: ['chat']
      })
    ]);

    expect(
      registry.resolveCommand({
        botUsername: 'fun_bot',
        mode: 'private_admin',
        text: '/read',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }]
      })
    ).toBeNull();
  });

  test('rejects duplicate command names', () => {
    expect(() =>
      createActionRegistry([
        action({ intent: 'answer', commands: ['answer'], modes: ['chat'] }),
        action({ intent: 'decide', commands: ['answer'], modes: ['chat'] })
      ])
    ).toThrow('Duplicate action command: answer');
  });
});

describe('chatActionRegistry command policy', () => {
  test.each([
    ['/summarize', 'summarize'],
    ['/decide', 'decide'],
    ['/read', 'read'],
    ['/answer', 'answer'],
    ['/translate', 'translate'],
    ['/meme', 'meme']
  ] as const)('resolves %s command intent in chat mode', (commandText, intent) => {
    const resolved = chatActionRegistry.resolveCommand({
      botUsername: 'fun_bot',
      mode: 'chat',
      text: `${commandText} ignored arguments`,
      entities: [{ type: 'bot_command', offset: 0, length: commandText.length }]
    });

    expect(resolved).toMatchObject({
      action: expect.objectContaining({ intent }),
      commandText
    });
  });

  test.each([
    ['/summarize@fun_bot', 'summarize'],
    ['/decide@fun_bot', 'decide'],
    ['/read@fun_bot', 'read'],
    ['/answer@fun_bot', 'answer'],
    ['/translate@fun_bot', 'translate'],
    ['/meme@fun_bot', 'meme']
  ] as const)('resolves %s bot-suffixed command in chat mode', (commandText, intent) => {
    const resolved = chatActionRegistry.resolveCommand({
      botUsername: 'fun_bot',
      mode: 'chat',
      text: `${commandText} ignored arguments`,
      entities: [{ type: 'bot_command', offset: 0, length: commandText.length }]
    });

    expect(resolved).toMatchObject({
      action: expect.objectContaining({ intent }),
      commandText
    });
  });

  test.each([
    '/explain',
    '/explain@fun_bot'
  ] as const)('returns none for removed %s command', (commandText) => {
    const resolved = chatActionRegistry.resolveCommand({
      botUsername: 'fun_bot',
      mode: 'chat',
      text: `${commandText} ignored arguments`,
      entities: [{ type: 'bot_command', offset: 0, length: commandText.length }]
    });

    expect(resolved).toBeNull();
  });

  test('returns none for commands addressed to another bot', () => {
    const resolved = chatActionRegistry.resolveCommand({
      botUsername: 'fun_bot',
      mode: 'chat',
      text: '/decide@other_bot ignored arguments',
      entities: [
        {
          type: 'bot_command',
          offset: 0,
          length: '/decide@other_bot'.length
        }
      ]
    });

    expect(resolved).toBeNull();
  });

  test('returns none for ordinary bot mentions', () => {
    const resolved = chatActionRegistry.resolveCommand({
      botUsername: 'fun_bot',
      mode: 'chat',
      text: 'эй, @fun_bot, расскажи что-нибудь',
      entities: [{ type: 'mention', offset: 4, length: 8 }]
    });

    expect(resolved).toBeNull();
  });

  test.each([
    '/summarize',
    '/decide',
    '/read',
    '/answer',
    '/translate',
    '/meme'
  ] as const)('returns none for %s command in private admin mode', (commandText) => {
    const resolved = chatActionRegistry.resolveCommand({
      botUsername: 'fun_bot',
      mode: 'private_admin',
      text: `${commandText} ignored arguments`,
      entities: [{ type: 'bot_command', offset: 0, length: commandText.length }]
    });

    expect(resolved).toBeNull();
  });

  test.each([
    '/publish',
    '/publish@fun_bot'
  ] as const)('resolves %s command only in private admin mode', (commandText) => {
    const resolved = chatActionRegistry.resolveCommand({
      botUsername: 'fun_bot',
      mode: 'private_admin',
      text: `${commandText} ignored arguments`,
      entities: [{ type: 'bot_command', offset: 0, length: commandText.length }]
    });

    expect(resolved).toMatchObject({
      action: expect.objectContaining({
        intent: 'publish'
      }),
      commandText
    });
  });

  test.each([
    '/publish',
    '/publish@fun_bot'
  ] as const)('returns none for %s command in chat mode', (commandText) => {
    const resolved = chatActionRegistry.resolveCommand({
      botUsername: 'fun_bot',
      mode: 'chat',
      text: `${commandText} ignored arguments`,
      entities: [{ type: 'bot_command', offset: 0, length: commandText.length }]
    });

    expect(resolved).toBeNull();
  });

  test.each([
    '/news',
    '/news@fun_bot'
  ] as const)('returns none for removed %s command in private admin mode', (commandText) => {
    const resolved = chatActionRegistry.resolveCommand({
      botUsername: 'fun_bot',
      mode: 'private_admin',
      text: `${commandText} ignored arguments`,
      entities: [{ type: 'bot_command', offset: 0, length: commandText.length }]
    });

    expect(resolved).toBeNull();
  });
});
