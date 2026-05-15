import type {
  ActionRegistry,
  ChatAction,
  ResolveCommandInput,
  ResolvedAction
} from './types.js';

export function createActionRegistry(actions: ChatAction[]): ActionRegistry {
  const byCommand = new Map<string, ChatAction>();

  for (const action of actions) {
    for (const command of action.commands) {
      const normalized = command.toLowerCase();

      if (byCommand.has(normalized)) {
        throw new Error(`Duplicate action command: ${normalized}`);
      }

      byCommand.set(normalized, action);
    }
  }

  return {
    resolveCommand(input) {
      const commandText = getCommandText(input);

      if (!commandText) return null;

      const parsed = parseCommandText(commandText);

      if (!parsed) return null;

      if (
        parsed.botUsername &&
        (!input.botUsername ||
          parsed.botUsername.toLowerCase() !== input.botUsername.toLowerCase())
      ) {
        return null;
      }

      const action = byCommand.get(parsed.commandName.toLowerCase());

      const mode = input.mode ?? 'chat';

      if (!action?.modes.includes(mode)) {
        return null;
      }

      return { action, commandText } satisfies ResolvedAction;
    }
  };
}

function getCommandText(input: ResolveCommandInput): string | null {
  const commandEntity = input.entities?.find(
    (entity) => entity.type === 'bot_command' && entity.offset === 0
  );

  if (!commandEntity) return null;

  return input.text.slice(
    commandEntity.offset,
    commandEntity.offset + commandEntity.length
  );
}

function parseCommandText(
  commandText: string
): { commandName: string; botUsername: string | null } | null {
  const match = /^\/([A-Za-z0-9_]+)(?:@([A-Za-z0-9_]+))?$/.exec(commandText);

  if (!match) return null;

  return {
    commandName: match[1] ?? '',
    botUsername: match[2] ?? null
  };
}
