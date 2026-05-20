import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { Context } from 'grammy';

import { mediaProviderConfig } from '../config/runtime/index.js';
import type { MediaMessageSnapshot } from '../domain/models.js';

type TelegramReplyMessage = NonNullable<Context['message']> & {
  reply_to_message?: {
    message_id: number;
    caption?: unknown;
    voice?: TelegramFileMedia & { duration?: unknown };
    audio?: TelegramFileMedia & { duration?: unknown };
    video?: TelegramFileMedia & { duration?: unknown };
    video_note?: TelegramFileMedia & { duration?: unknown };
    photo?: TelegramPhotoSize[];
    document?: TelegramFileMedia & { file_name?: unknown };
  };
};

type TelegramFileMedia = {
  file_id?: unknown;
  file_unique_id?: unknown;
  mime_type?: unknown;
  file_size?: unknown;
};

type TelegramPhotoSize = {
  file_id?: unknown;
  file_unique_id?: unknown;
  file_size?: unknown;
};

type TelegramFileApi = {
  getFile(fileId: string): Promise<{ file_path?: string | null }>;
};

export function extractReplyToMediaSnapshot(
  message: NonNullable<Context['message']>
): MediaMessageSnapshot | null {
  const reply = (message as TelegramReplyMessage).reply_to_message;

  if (!reply) {
    return null;
  }

  return extractMessageMediaSnapshot(reply);
}

export function extractMessageMediaSnapshot(message: {
  message_id: number;
  caption?: unknown;
  voice?: TelegramFileMedia & { duration?: unknown };
  audio?: TelegramFileMedia & { duration?: unknown };
  video?: TelegramFileMedia & { duration?: unknown };
  video_note?: TelegramFileMedia & { duration?: unknown };
  photo?: TelegramPhotoSize[];
  document?: TelegramFileMedia & { file_name?: unknown };
}): MediaMessageSnapshot | null {
  const reply = message;

  const caption = normalizeCaption(reply.caption);

  if (reply.voice) {
    return fromFileMedia({
      messageId: reply.message_id,
      mediaKind: 'voice',
      media: reply.voice,
      fallbackMimeType: 'audio/ogg',
      caption
    });
  }

  if (reply.audio) {
    return fromFileMedia({
      messageId: reply.message_id,
      mediaKind: 'audio',
      media: reply.audio,
      fallbackMimeType: null,
      caption
    });
  }

  if (reply.video) {
    return fromFileMedia({
      messageId: reply.message_id,
      mediaKind: 'video',
      media: reply.video,
      fallbackMimeType: 'video/mp4',
      caption
    });
  }

  if (reply.video_note) {
    return fromFileMedia({
      messageId: reply.message_id,
      mediaKind: 'video_note',
      media: reply.video_note,
      fallbackMimeType: 'video/mp4',
      caption
    });
  }

  if (Array.isArray(reply.photo) && reply.photo.length > 0) {
    const photo = selectLargestPhoto(reply.photo);

    return fromPhoto({
      messageId: reply.message_id,
      photo,
      caption
    });
  }

  if (reply.document && isImageMimeType(reply.document.mime_type)) {
    return fromFileMedia({
      messageId: reply.message_id,
      mediaKind: 'document_image',
      media: reply.document,
      fallbackMimeType: null,
      caption
    });
  }

  return null;
}

export async function downloadTelegramFileToTemp(input: {
  api: TelegramFileApi;
  botToken: string;
  fileId: string;
  filename: string;
  maxBytes: number;
  fileSize?: number | null;
  fetch?: typeof fetch | undefined;
  tempDir?: string;
  timeoutMs?: number;
}): Promise<{
  filePath: string;
  bytes: number;
  cleanup: () => Promise<void>;
}> {
  if (input.fileSize !== null && input.fileSize !== undefined) {
    assertMaxBytes(input.fileSize, input.maxBytes);
  }

  const telegramFile = await input.api.getFile(input.fileId);
  const filePath = telegramFile.file_path;

  if (!filePath) {
    throw new Error('Telegram getFile response was missing file_path.');
  }

  const fetchImpl = input.fetch ?? globalThis.fetch;
  const { signal, clear } = createTimeoutSignal(
    input.timeoutMs ?? mediaProviderConfig.telegram.fileDownloadTimeoutMs
  );
  let response: Response;

  try {
    response = await fetchImpl(
      `${mediaProviderConfig.telegram.fileEndpointBase}/bot${input.botToken}/${filePath}`,
      { signal }
    );
  } finally {
    clear();
  }

  if (!response.ok) {
    throw new Error(
      `Telegram file download failed with status ${response.status}.`
    );
  }

  const bytes = await readResponseBytesWithLimit(response, input.maxBytes);
  assertMaxBytes(bytes.byteLength, input.maxBytes);

  const tempDirectory = await mkdtemp(
    path.join(input.tempDir ?? os.tmpdir(), 'telegram-media-')
  );
  const localFilePath = path.join(tempDirectory, path.basename(input.filename));

  await writeFile(localFilePath, bytes);

  return {
    filePath: localFilePath,
    bytes: bytes.byteLength,
    cleanup: async () => {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  };
}

function fromFileMedia(input: {
  messageId: number;
  mediaKind: MediaMessageSnapshot['mediaKind'];
  media: TelegramFileMedia & { duration?: unknown };
  fallbackMimeType: string | null;
  caption: string | null;
}): MediaMessageSnapshot | null {
  const fileId = readString(input.media.file_id);

  if (!fileId) {
    return null;
  }

  return {
    messageId: input.messageId,
    mediaKind: input.mediaKind,
    fileId,
    fileUniqueId: readString(input.media.file_unique_id),
    mimeType: readString(input.media.mime_type) ?? input.fallbackMimeType,
    fileSize: readNumber(input.media.file_size),
    durationSeconds: readNumber(input.media.duration),
    caption: input.caption
  };
}

function fromPhoto(input: {
  messageId: number;
  photo: TelegramPhotoSize;
  caption: string | null;
}): MediaMessageSnapshot | null {
  const fileId = readString(input.photo.file_id);

  if (!fileId) {
    return null;
  }

  return {
    messageId: input.messageId,
    mediaKind: 'photo',
    fileId,
    fileUniqueId: readString(input.photo.file_unique_id),
    mimeType: null,
    fileSize: readNumber(input.photo.file_size),
    durationSeconds: null,
    caption: input.caption
  };
}

function selectLargestPhoto(photos: TelegramPhotoSize[]): TelegramPhotoSize {
  return photos.reduce<TelegramPhotoSize>((largest, current) => {
    const largestSize = readNumber(largest.file_size);
    const currentSize = readNumber(current.file_size);

    if (largestSize === null && currentSize === null) {
      return current;
    }

    if (
      currentSize !== null &&
      (largestSize === null || currentSize > largestSize)
    ) {
      return current;
    }

    return largest;
  }, photos[0] as TelegramPhotoSize);
}

function normalizeCaption(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

function isImageMimeType(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith('image/');
}

function assertMaxBytes(bytes: number, maxBytes: number): void {
  if (bytes > maxBytes) {
    throw new Error(`Media file is too large: ${bytes} bytes.`);
  }
}

async function readResponseBytesWithLimit(
  response: Response,
  maxBytes: number
): Promise<Uint8Array> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    assertMaxBytes(bytes.byteLength, maxBytes);
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const result = await reader.read();

      if (result.done) {
        break;
      }

      chunks.push(result.value);
      totalBytes += result.value.byteLength;

      if (totalBytes > maxBytes) {
        await reader.cancel();
        assertMaxBytes(totalBytes, maxBytes);
      }
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

function createTimeoutSignal(timeoutMs: number): {
  signal: AbortSignal;
  clear: () => void;
} {
  if (typeof AbortSignal.timeout === 'function') {
    return {
      signal: AbortSignal.timeout(timeoutMs),
      clear: () => undefined
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer)
  };
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
