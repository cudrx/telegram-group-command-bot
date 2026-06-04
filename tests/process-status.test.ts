import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { runWithProcessStatus } from '../src/app/process-status.js';
import type { TelegramChatAction } from '../src/app/typing-indicator.js';

describe('runWithProcessStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('falls back to classic typing when no status config is provided', async () => {
    const sendChatAction = vi.fn().mockResolvedValue(undefined);
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 11,
      createdAt: '2026-06-02T10:00:00.000Z'
    });

    await runWithProcessStatus(
      createDeps({
        sendChatAction,
        replyDispatcher
      }),
      {
        chatId: 42
      },
      async () => 'ok'
    );

    expect(sendChatAction).toHaveBeenCalledWith(42, 'typing');
    expect(replyDispatcher).not.toHaveBeenCalled();
  });

  test('creates, updates, and deletes a status message while refreshing chat action', async () => {
    const sendChatAction = vi.fn().mockResolvedValue(undefined);
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 51,
      createdAt: '2026-06-02T10:00:00.000Z'
    });
    const editMessageTextDispatcher = vi.fn().mockResolvedValue(undefined);
    const deleteMessageDispatcher = vi.fn().mockResolvedValue(undefined);

    await runWithProcessStatus(
      createDeps({
        sendChatAction,
        replyDispatcher,
        editMessageTextDispatcher,
        deleteMessageDispatcher
      }),
      {
        chatId: 42,
        replyToMessageId: 7,
        status: {
          preset: 'transcription'
        }
      },
      async (status) => {
        await status.stage('download');
        await status.stage('transcribe');
      }
    );

    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 42,
      replyToMessageId: 7,
      text: 'Готовит расшифровку'
    });
    expect(editMessageTextDispatcher).toHaveBeenNthCalledWith(1, {
      chatId: 42,
      messageId: 51,
      text: 'Скачивает видео'
    });
    expect(editMessageTextDispatcher).toHaveBeenNthCalledWith(2, {
      chatId: 42,
      messageId: 51,
      text: 'Распознаёт речь'
    });
    expect(deleteMessageDispatcher).toHaveBeenCalledWith({
      chatId: 42,
      messageId: 51
    });
    expect(sendChatAction).toHaveBeenCalledWith(42, 'typing');
  });

  test('keeps the process alive when editing the status message fails', async () => {
    const sendChatAction = vi.fn().mockResolvedValue(undefined);
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 91,
      createdAt: '2026-06-02T10:00:00.000Z'
    });
    const editMessageTextDispatcher = vi
      .fn()
      .mockRejectedValue(new Error('edit failed'));
    const deleteMessageDispatcher = vi.fn().mockResolvedValue(undefined);
    const operation = vi.fn().mockResolvedValue('done');

    await expect(
      runWithProcessStatus(
        createDeps({
          sendChatAction,
          replyDispatcher,
          editMessageTextDispatcher,
          deleteMessageDispatcher
        }),
        {
          chatId: 5,
          status: {
            preset: 'video_pipeline'
          }
        },
        async (status) => {
          await status.stage('download');
          await status.stage('convert');
          return operation();
        }
      )
    ).resolves.toBe('done');

    expect(editMessageTextDispatcher).toHaveBeenCalledTimes(1);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(deleteMessageDispatcher).toHaveBeenCalledWith({
      chatId: 5,
      messageId: 91
    });
  });
});

function createDeps(input: {
  sendChatAction?: (
    chatId: number,
    action: TelegramChatAction
  ) => Promise<void>;
  replyDispatcher?: (input: {
    chatId: number;
    replyToMessageId?: number | null;
    reply?: boolean;
    text: string;
  }) => Promise<{ messageId: number; createdAt: string }>;
  editMessageTextDispatcher?: (input: {
    chatId: number;
    messageId: number;
    text: string;
  }) => Promise<void>;
  deleteMessageDispatcher?: (input: {
    chatId: number;
    messageId: number;
  }) => Promise<void>;
}) {
  return {
    env: {
      replyMinTypingMs: 0,
      replyMaxTypingMs: 0,
      replyTypingRefreshMs: 4000
    },
    random: () => 0,
    delay: vi.fn().mockResolvedValue(undefined),
    sendChatAction:
      input.sendChatAction ?? vi.fn().mockResolvedValue(undefined),
    replyDispatcher:
      input.replyDispatcher ??
      vi.fn().mockResolvedValue({
        messageId: 1,
        createdAt: '2026-06-02T10:00:00.000Z'
      }),
    editMessageTextDispatcher:
      input.editMessageTextDispatcher ?? vi.fn().mockResolvedValue(undefined),
    deleteMessageDispatcher:
      input.deleteMessageDispatcher ?? vi.fn().mockResolvedValue(undefined)
  };
}
