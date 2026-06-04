import { text } from '../locales/locale.js';
import type { ChatOrchestratorDeps } from './chat-orchestrator/types.js';
import type { TelegramChatAction } from './typing-indicator.js';
import { withChatActionIndicator } from './typing-indicator.js';

type ProcessStatusDeps = Pick<
  ChatOrchestratorDeps,
  | 'delay'
  | 'deleteMessageDispatcher'
  | 'editMessageTextDispatcher'
  | 'random'
  | 'replyDispatcher'
  | 'sendChatAction'
> & {
  env: Pick<
    ChatOrchestratorDeps['env'],
    'replyMinTypingMs' | 'replyMaxTypingMs' | 'replyTypingRefreshMs'
  >;
};

type ProcessStatusPreset = keyof typeof text.processStatus.presets;
type ProcessStatusMode = 'action_only' | 'message_only' | 'message_and_action';
type ProcessStageCatalog = Record<string, string>;

export type ProcessStatusReporter = {
  stage(name: string): Promise<void>;
  message(value: string): Promise<void>;
};

type ProcessStatusOptions = {
  chatId: number;
  replyToMessageId?: number | null;
  reply?: boolean;
  action?: TelegramChatAction;
  status?: {
    preset: ProcessStatusPreset;
    mode?: ProcessStatusMode;
    startStage?: string | null;
    deleteOnFinish?: boolean;
  };
};

const PROCESS_STATUS_PRESET_ACTIONS: Record<
  ProcessStatusPreset,
  TelegramChatAction
> = {
  meme_search: 'typing',
  reply_generation: 'typing',
  transcription: 'typing',
  video_pipeline: 'upload_video',
  voice_generation: 'record_voice'
};

const NOOP_PROCESS_STATUS: ProcessStatusReporter = {
  async stage() {},
  async message() {}
};

export async function runWithProcessStatus<T>(
  deps: ProcessStatusDeps,
  input: ProcessStatusOptions,
  operation: (status: ProcessStatusReporter) => Promise<T>
): Promise<T> {
  const configuredStatus = input.status;

  if (!configuredStatus) {
    return withChatActionIndicator(
      {
        chatId: input.chatId,
        action: input.action ?? 'typing',
        minVisibleMs: deps.env.replyMinTypingMs,
        maxVisibleMs: deps.env.replyMaxTypingMs,
        refreshMs: deps.env.replyTypingRefreshMs,
        random: deps.random,
        delay: deps.delay,
        sendChatAction: deps.sendChatAction
      },
      () => operation(NOOP_PROCESS_STATUS)
    );
  }

  const stages = text.processStatus.presets[configuredStatus.preset];
  const action =
    input.action ?? PROCESS_STATUS_PRESET_ACTIONS[configuredStatus.preset];
  const mode = configuredStatus.mode ?? 'message_and_action';
  const startStage =
    configuredStatus.startStage === null
      ? null
      : (configuredStatus.startStage ?? 'start');
  const deleteOnFinish = configuredStatus.deleteOnFinish ?? true;
  const shouldUseMessage =
    mode === 'message_only' || mode === 'message_and_action';
  const shouldUseAction =
    mode === 'action_only' || mode === 'message_and_action';
  let statusMessageId: number | null = null;
  let lastMessageText: string | null = null;
  let allowMessageUpdates = shouldUseMessage;

  const status: ProcessStatusReporter = {
    stage: async (name) => {
      const stageText = readStageText(stages, name);
      await updateStatusMessage(stageText);
    },
    message: async (value) => {
      await updateStatusMessage(value);
    }
  };

  async function updateStatusMessage(nextText: string): Promise<void> {
    if (!allowMessageUpdates || nextText === lastMessageText) {
      return;
    }

    if (statusMessageId === null) {
      lastMessageText = nextText;
      return;
    }

    try {
      await deps.editMessageTextDispatcher({
        chatId: input.chatId,
        messageId: statusMessageId,
        text: nextText
      });
      lastMessageText = nextText;
    } catch {
      allowMessageUpdates = false;
    }
  }

  if (allowMessageUpdates && startStage !== null) {
    const startText = readStageText(stages, startStage);

    try {
      const messageInput = {
        chatId: input.chatId,
        ...(input.replyToMessageId !== undefined
          ? { replyToMessageId: input.replyToMessageId }
          : {}),
        ...(input.reply !== undefined ? { reply: input.reply } : {}),
        text: startText
      };
      const sent = await deps.replyDispatcher(messageInput);
      statusMessageId = sent.messageId;
      lastMessageText = startText;
    } catch {
      allowMessageUpdates = false;
    }
  }

  const runOperation = () => operation(status);

  try {
    if (!shouldUseAction) {
      return await runOperation();
    }

    return await withChatActionIndicator(
      {
        chatId: input.chatId,
        action,
        minVisibleMs: deps.env.replyMinTypingMs,
        maxVisibleMs: deps.env.replyMaxTypingMs,
        refreshMs: deps.env.replyTypingRefreshMs,
        random: deps.random,
        delay: deps.delay,
        sendChatAction: deps.sendChatAction
      },
      runOperation
    );
  } finally {
    if (deleteOnFinish && statusMessageId !== null) {
      try {
        await deps.deleteMessageDispatcher({
          chatId: input.chatId,
          messageId: statusMessageId
        });
      } catch {
        // Process status cleanup is best-effort and must never block the reply.
      }
    }
  }
}

function readStageText(stages: ProcessStageCatalog, name: string): string {
  const value = stages[name];

  if (!value) {
    throw new Error(`Unknown process status stage: ${name}`);
  }

  return value;
}
