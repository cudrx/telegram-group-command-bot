import type {
  AssistantIntent,
  AuthorizedMode,
  DirectTrigger,
  DirectTriggerIntent
} from './models.js';

export type DetectDirectTriggerInput = {
  botUserId: number;
  botUsername: string | null;
  message: {
    authorizedMode?: AuthorizedMode;
    text: string;
    entities?: Array<{ type: string; offset: number; length: number }>;
    replyToUserId: number | null;
  };
};

type DecideReplyActionInput = {
  directTrigger: DirectTrigger;
};

type DecideReplyActionResult = {
  shouldReply: boolean;
  reason: 'command' | 'ignore';
  intent?: AssistantIntent;
};

const CHAT_COMMAND_INTENTS: Record<string, AssistantIntent> = {
  summarize: 'summarize',
  decide: 'decide',
  read: 'read',
  answer: 'answer',
  translate: 'translate',
  meme: 'meme'
};

export function detectDirectTrigger(
  input: DetectDirectTriggerInput
): DirectTrigger {
  return detectCommandTrigger(input) ?? { kind: 'none' };
}

export function decideReplyAction(
  input: DecideReplyActionInput
): DecideReplyActionResult {
  if (
    input.directTrigger.kind === 'command' &&
    isAssistantIntent(input.directTrigger.intent)
  ) {
    return {
      shouldReply: true,
      reason: 'command',
      intent: input.directTrigger.intent
    };
  }

  return {
    shouldReply: false,
    reason: 'ignore'
  };
}

function isAssistantIntent(
  intent: DirectTriggerIntent
): intent is AssistantIntent {
  return intent !== 'weekly';
}

function detectCommandTrigger(
  input: DetectDirectTriggerInput
): DirectTrigger | null {
  const commandEntity = input.message.entities?.find(
    (entity) => entity.type === 'bot_command' && entity.offset === 0
  );

  if (!commandEntity) {
    return null;
  }

  const commandText = input.message.text.slice(
    commandEntity.offset,
    commandEntity.offset + commandEntity.length
  );
  const parsed = parseCommandText(commandText);

  if (!parsed) {
    return null;
  }

  if (
    parsed.botUsername &&
    (!input.botUsername ||
      parsed.botUsername.toLowerCase() !== input.botUsername.toLowerCase())
  ) {
    return null;
  }

  const commandName = parsed.commandName.toLowerCase();

  if (commandName === 'weekly') {
    if (input.message.authorizedMode !== 'private_admin') {
      return null;
    }

    return {
      kind: 'command',
      intent: 'weekly',
      commandText
    };
  }

  if (!allowsCommands(input.message.authorizedMode)) {
    return null;
  }

  const intent = CHAT_COMMAND_INTENTS[commandName];

  if (!intent) {
    return null;
  }

  return {
    kind: 'command',
    intent,
    commandText
  };
}

function allowsCommands(mode: AuthorizedMode | undefined): boolean {
  return mode === undefined || mode === 'chat';
}

function parseCommandText(
  commandText: string
): { commandName: string; botUsername: string | null } | null {
  const match = /^\/([A-Za-z0-9_]+)(?:@([A-Za-z0-9_]+))?$/.exec(commandText);

  if (!match) {
    return null;
  }

  return {
    commandName: match[1] ?? '',
    botUsername: match[2] ?? null
  };
}
