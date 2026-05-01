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

    await vi.waitFor(() => {
      expect(db.savedMediaArtifacts).toContainEqual(
        expect.objectContaining({
          artifactKind: 'auto_read',
          artifactStatus: 'failed',
          errorText: 'Media recognition returned no context.'
        })
      );
    });
    expect(replyDispatcher).not.toHaveBeenCalled();
  });

  test('uses legacy vision_raw when download fails and no new image artifacts exist', async () => {
    const db = new FakeDatabaseClient();
    saveVisionRaw(db);

    const replyDispatcher = createReplyDispatcher();
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply: vi.fn() } as never,
      replyDispatcher,
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

    await vi.waitFor(() => {
      expect(db.savedMediaArtifacts).toContainEqual(
        expect.objectContaining({
          artifactKind: 'vision_raw',
          artifactStatus: 'success',
          artifactText: 'Legacy raw image description'
        })
      );
    });
    expect(
      db.savedMediaArtifacts.some(
        (artifact) => artifact.artifactStatus === 'failed'
      )
    ).toBe(false);
    expect(replyDispatcher).not.toHaveBeenCalled();
  });
});
