import type { AssistantIntent, ChatType, DirectTrigger } from './models.js';

export type DetectDirectTriggerInput = {
  botUserId: number;
  botUsername: string | null;
  message: {
    chatType?: ChatType;
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

const COMMAND_INTENTS: Record<string, AssistantIntent> = {
  summarize: 'summarize',
  decide: 'decide',
  read: 'read',
  answer: 'answer'
};

export function detectDirectTrigger(
  input: DetectDirectTriggerInput
): DirectTrigger {
  return detectCommandTrigger(input) ?? { kind: 'none' };
}

export function decideReplyAction(
  input: DecideReplyActionInput
): DecideReplyActionResult {
  if (input.directTrigger.kind === 'command') {
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

function detectCommandTrigger(
  input: DetectDirectTriggerInput
): DirectTrigger | null {
  if (!allowsCommands(input.message.chatType)) {
    return null;
  }

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

  const intent = COMMAND_INTENTS[parsed.commandName.toLowerCase()];

  if (!intent) {
    return null;
  }

  return {
    kind: 'command',
    intent,
    commandText
  };
}

function allowsCommands(chatType: ChatType | undefined): boolean {
  return (
    chatType === undefined ||
    chatType === 'private' ||
    chatType === 'group' ||
    chatType === 'supergroup'
  );
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
