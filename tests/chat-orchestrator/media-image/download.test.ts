import { describe, expect, test, vi } from 'vitest';

import { createOrchestrator, FakeDatabaseClient } from '../support.js';
import {
  createReadImageMessage,
  createReplyDispatcher,
  saveVisionRaw
} from './support.js';

describe('ChatOrchestrator media image download failures', () => {
  test('returns read failed placeholder when image download fails', async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi.fn();
    const replyDispatcher = createReplyDispatcher();
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply } as never,
      replyDispatcher,
      env: { mediaAnalysisEnabled: true },
      telegramFileApi: {
        getFile: vi.fn().mockResolvedValue({ file_path: 'photo/file.jpg' })
      },
      fetch: vi
        .fn()
        .mockRejectedValue(new Error('download failed')) as typeof fetch,
      visionProvider: { describe: vi.fn() },
      ocrProvider: { extractText: vi.fn() }
    });

    await orchestrator.handleIncomingMessage(createReadImageMessage());

    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'Не удалось распознать медиа. Попробуй позже или с другим файлом.'
    });
  });

  test('uses legacy vision_raw when download fails and no new image artifacts exist', async () => {
    const db = new FakeDatabaseClient();
    saveVisionRaw(db);

    const replyDispatcher = createReplyDispatcher();
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply: vi.fn() } as never,
      replyDispatcher,
      env: { mediaAnalysisEnabled: true },
      telegramFileApi: {
        getFile: vi.fn().mockResolvedValue({ file_path: 'photo/file.jpg' })
      },
      fetch: vi
        .fn()
        .mockRejectedValue(new Error('download failed')) as typeof fetch,
      visionProvider: {
        describe: vi.fn().mockRejectedValue(new Error('should not call'))
      },
      ocrProvider: {
        extractText: vi.fn().mockRejectedValue(new Error('should not call'))
      }
    });

    await orchestrator.handleIncomingMessage(createReadImageMessage());

    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'Legacy raw image description'
    });
  });
});
