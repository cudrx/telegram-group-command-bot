import path from 'node:path';

import { redditMediaActionConfig } from '../../../config/runtime/index.js';
import {
  execMediaFileDefault,
  MEDIA_EXEC_MAX_BUFFER,
  type MediaExecFile
} from '../../../media/exec.js';
import { formatInstagramReelCaption } from './instagram-reel-client.js';
import { resolveRuntimeFilePath } from './paths.js';
import { findTiktokUrl, formatTiktokCaption } from './tiktok-client.js';
import type { ResolvedMemeMedia } from './types.js';

const GALLERY_DL_BIN = 'gallery-dl';

type GalleryResult = {
  sourceUrl: string;
  caption: string;
  media: ResolvedMemeMedia;
};

export async function resolveInstagramGalleryWithGalleryDl(input: {
  text: string;
  sqlitePath: string;
  instagramCookiesPath?: string | null | undefined;
  execFile?: MediaExecFile | undefined;
}): Promise<GalleryResult | null> {
  const sourceUrl = findInstagramPostUrl(input.text);
  if (!sourceUrl) return null;

  const cookiesPath = resolveRuntimeFilePath(
    input.instagramCookiesPath ??
      path.join(path.dirname(input.sqlitePath), 'instagram-cookies.txt')
  );
  const resolved = await resolveGalleryRows({
    execFile: input.execFile ?? execMediaFileDefault,
    sourceUrl,
    args: ['--cookies', cookiesPath]
  });
  const rows = resolved.rows;
  const first = rows[0];
  if (!first) return null;

  return {
    sourceUrl,
    caption: formatInstagramReelCaption({
      nickname: readString(first.metadata, 'username') ?? 'unknown',
      likeCount: readNumber(first.metadata, 'likes') ?? 0,
      reelUrl: sourceUrl
    }),
    media: toResolvedMedia(rows)
  };
}

export async function resolveTiktokGalleryWithGalleryDl(input: {
  text: string;
  execFile?: MediaExecFile | undefined;
}): Promise<GalleryResult | null> {
  const sourceUrl = findTiktokUrl(input.text);
  if (!sourceUrl) return null;

  const resolved = await resolveGalleryRows({
    execFile: input.execFile ?? execMediaFileDefault,
    sourceUrl,
    args: []
  });
  if (resolved.rows.some((row) => row.extension === 'mp4')) return null;

  const rows = resolved.rows;
  const first = rows[0];
  if (!first) return null;

  return {
    sourceUrl,
    caption: formatTiktokCaption({
      creator:
        readNestedString(first.metadata, 'author', 'uniqueId') ?? 'unknown',
      likeCount: readNestedNumber(first.metadata, 'stats', 'diggCount') ?? 0,
      sourceUrl
    }),
    media: toResolvedMedia(rows)
  };
}

export function findInstagramPostUrl(text: string): string | null {
  const matches = text.match(/https?:\/\/[^\s<>"']+/g) ?? [];

  for (const match of matches) {
    let parsed: URL;

    try {
      parsed = new URL(match.replace(/[),.]+$/u, ''));
    } catch {
      continue;
    }

    if (
      parsed.hostname !== 'instagram.com' &&
      !parsed.hostname.endsWith('.instagram.com')
    ) {
      continue;
    }

    const parts = parsed.pathname.split('/').filter(Boolean);
    const postIndex = parts.findIndex((part) => part.toLowerCase() === 'p');
    const shortcode = postIndex >= 0 ? parts[postIndex + 1] : undefined;
    if (!shortcode) continue;

    parsed.hash = '';
    parsed.search = '';
    parsed.pathname = `/p/${shortcode}/`;

    return parsed.toString();
  }

  return null;
}

type GalleryRow = {
  mediaUrl: string;
  extension: 'jpg' | 'jpeg' | 'png' | 'webp' | 'mp4';
  num: number;
  metadata: Record<string, unknown>;
};

async function resolveGalleryRows(input: {
  execFile: MediaExecFile;
  sourceUrl: string;
  args: string[];
}): Promise<{ rows: GalleryRow[] }> {
  const result = await input.execFile(
    GALLERY_DL_BIN,
    [...input.args, '--resolve-json', input.sourceUrl],
    {
      maxBuffer: MEDIA_EXEC_MAX_BUFFER,
      timeoutMs: redditMediaActionConfig.telegramMedia.metadataTimeoutMs
    }
  );
  const payload = JSON.parse(result.stdout) as unknown;
  if (!Array.isArray(payload)) return { rows: [] };

  const rows = payload
    .flatMap((value): GalleryRow[] => {
      if (!Array.isArray(value) || value[0] !== 3) return [];

      const mediaUrl = value[1];
      const metadata = value[2];
      if (typeof mediaUrl !== 'string' || !isRecord(metadata)) return [];

      const extension = readMediaExtension(metadata.extension);
      if (!extension) return [];
      const resolvedMediaUrl =
        extension === 'mp4'
          ? (readString(metadata, 'video_url') ?? mediaUrl)
          : mediaUrl;
      if (resolvedMediaUrl.startsWith('ytdl:')) return [];

      return [
        {
          mediaUrl: resolvedMediaUrl,
          extension,
          num: readNumber(metadata, 'num') ?? Number.MAX_SAFE_INTEGER,
          metadata
        }
      ];
    })
    .sort((left, right) => left.num - right.num);

  return { rows };
}

function toResolvedMedia(rows: GalleryRow[]): ResolvedMemeMedia {
  const items = rows.map(({ mediaUrl, extension }) =>
    extension === 'mp4'
      ? {
          kind: 'video' as const,
          mediaUrl,
          extension,
          downloadStrategy: 'yt-dlp' as const
        }
      : { mediaUrl, extension }
  );
  const first = items[0];

  if (items.length === 1 && first) {
    return first.kind === 'video' ? first : { kind: 'image', ...first };
  }

  return { kind: 'gallery', items };
}

function readMediaExtension(value: unknown): GalleryRow['extension'] | null {
  if (
    value === 'jpg' ||
    value === 'jpeg' ||
    value === 'png' ||
    value === 'webp' ||
    value === 'mp4'
  ) {
    return value;
  }

  return null;
}

function readString(
  value: Record<string, unknown>,
  key: string
): string | null {
  const field = value[key];

  return typeof field === 'string' && field.trim() ? field.trim() : null;
}

function readNumber(
  value: Record<string, unknown>,
  key: string
): number | null {
  const field = value[key];

  return typeof field === 'number' && Number.isFinite(field) ? field : null;
}

function readNestedString(
  value: Record<string, unknown>,
  parentKey: string,
  key: string
): string | null {
  const parent = value[parentKey];

  return isRecord(parent) ? readString(parent, key) : null;
}

function readNestedNumber(
  value: Record<string, unknown>,
  parentKey: string,
  key: string
): number | null {
  const parent = value[parentKey];

  return isRecord(parent) ? readNumber(parent, key) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
