import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  downloadTelegramFileToTemp,
  extractReplyToMediaSnapshot
} from '../src/media/telegram-media.js';

const tempDirectories: string[] = [];

afterEach(async () => {
  for (const directory of tempDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('extractReplyToMediaSnapshot', () => {
  test('extracts replied-to voice media metadata', () => {
    expect(
      extractReplyToMediaSnapshot(
        createMessage({
          voice: {
            file_id: 'voice-file',
            file_unique_id: 'voice-unique',
            duration: 14,
            mime_type: 'audio/ogg',
            file_size: 288417
          },
          caption: '  voice caption  '
        })
      )
    ).toEqual({
      messageId: 90,
      mediaKind: 'voice',
      fileId: 'voice-file',
      fileUniqueId: 'voice-unique',
      mimeType: 'audio/ogg',
      fileSize: 288417,
      durationSeconds: 14,
      caption: 'voice caption'
    });
  });

  test('extracts replied-to video note metadata', () => {
    expect(
      extractReplyToMediaSnapshot(
        createMessage({
          video_note: {
            file_id: 'circle-file',
            file_unique_id: 'circle-unique',
            duration: 15,
            file_size: 2105948
          }
        })
      )
    ).toMatchObject({
      mediaKind: 'video_note',
      fileId: 'circle-file',
      fileUniqueId: 'circle-unique',
      mimeType: 'video/mp4',
      fileSize: 2105948,
      durationSeconds: 15,
      caption: null
    });
  });

  test('extracts replied-to audio metadata', () => {
    expect(
      extractReplyToMediaSnapshot(
        createMessage({
          audio: {
            file_id: 'audio-file',
            file_unique_id: 'audio-unique',
            duration: 7,
            mime_type: 'audio/mpeg',
            file_size: 1234
          }
        })
      )
    ).toMatchObject({
      mediaKind: 'audio',
      fileId: 'audio-file',
      fileUniqueId: 'audio-unique',
      mimeType: 'audio/mpeg',
      fileSize: 1234,
      durationSeconds: 7
    });
  });

  test('selects the largest replied-to photo size', () => {
    expect(
      extractReplyToMediaSnapshot(
        createMessage({
          photo: [
            {
              file_id: 'small-photo',
              file_unique_id: 'small-unique',
              file_size: 100
            },
            {
              file_id: 'large-photo',
              file_unique_id: 'large-unique',
              file_size: 500
            }
          ],
          caption: ''
        })
      )
    ).toEqual({
      messageId: 90,
      mediaKind: 'photo',
      fileId: 'large-photo',
      fileUniqueId: 'large-unique',
      mimeType: null,
      fileSize: 500,
      durationSeconds: null,
      caption: null
    });
  });

  test('extracts image document metadata', () => {
    expect(
      extractReplyToMediaSnapshot(
        createMessage({
          document: {
            file_id: 'document-file',
            file_unique_id: 'document-unique',
            mime_type: 'image/png',
            file_size: 777
          }
        })
      )
    ).toMatchObject({
      mediaKind: 'document_image',
      fileId: 'document-file',
      fileUniqueId: 'document-unique',
      mimeType: 'image/png',
      fileSize: 777,
      durationSeconds: null
    });
  });

  test('returns null for unsupported replies', () => {
    expect(extractReplyToMediaSnapshot(createMessage({ text: 'hello' }))).toBe(
      null
    );
    expect(
      extractReplyToMediaSnapshot(
        createMessage({
          document: {
            file_id: 'document-file',
            file_unique_id: 'document-unique',
            mime_type: 'application/pdf',
            file_size: 777
          }
        })
      )
    ).toBe(null);
  });

  test('returns null when there is no reply', () => {
    expect(
      extractReplyToMediaSnapshot({
        message_id: 100
      } as never)
    ).toBe(null);
  });
});

describe('downloadTelegramFileToTemp', () => {
  test('downloads telegram file to temp and cleans it up', async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), 'telegram-media-test-')
    );
    tempDirectories.push(tempDir);
    const api = {
      getFile: vi.fn().mockResolvedValue({ file_path: 'voice/file.ogg' })
    };
    const fetchStub = vi
      .fn()
      .mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));

    const downloaded = await downloadTelegramFileToTemp({
      api,
      botToken: 'token',
      fileId: 'file-id',
      filename: 'file.ogg',
      maxBytes: 10,
      fetch: fetchStub,
      tempDir
    });

    expect(api.getFile).toHaveBeenCalledWith('file-id');
    expect(fetchStub).toHaveBeenCalledWith(
      'https://api.telegram.org/file/bottoken/voice/file.ogg'
    );
    expect(downloaded.filePath).toContain('file.ogg');
    expect(downloaded.bytes).toBe(3);
    expect(await readFile(downloaded.filePath)).toEqual(Buffer.from([1, 2, 3]));

    await downloaded.cleanup();
    await expect(readFile(downloaded.filePath)).rejects.toThrow();
  });

  test('rejects media larger than the configured limit before download', async () => {
    const api = {
      getFile: vi.fn().mockResolvedValue({ file_path: 'voice/file.ogg' })
    };
    const fetchStub = vi.fn();

    await expect(
      downloadTelegramFileToTemp({
        api,
        botToken: 'token',
        fileId: 'file-id',
        filename: 'file.ogg',
        maxBytes: 10,
        fileSize: 11,
        fetch: fetchStub
      })
    ).rejects.toThrow('Media file is too large: 11 bytes.');
    expect(api.getFile).not.toHaveBeenCalled();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  test('rejects downloaded media larger than the configured limit', async () => {
    const api = {
      getFile: vi.fn().mockResolvedValue({ file_path: 'voice/file.ogg' })
    };
    const fetchStub = vi
      .fn()
      .mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));

    await expect(
      downloadTelegramFileToTemp({
        api,
        botToken: 'token',
        fileId: 'file-id',
        filename: 'file.ogg',
        maxBytes: 2,
        fetch: fetchStub
      })
    ).rejects.toThrow('Media file is too large: 3 bytes.');
  });

  test('throws when Telegram getFile has no file path', async () => {
    await expect(
      downloadTelegramFileToTemp({
        api: {
          getFile: vi.fn().mockResolvedValue({})
        },
        botToken: 'token',
        fileId: 'file-id',
        filename: 'file.ogg',
        maxBytes: 10,
        fetch: vi.fn()
      })
    ).rejects.toThrow('Telegram getFile response was missing file_path.');
  });
});

function createMessage(replyToMessage: Record<string, unknown>) {
  return {
    message_id: 100,
    reply_to_message: {
      message_id: 90,
      ...replyToMessage
    }
  } as never;
}
