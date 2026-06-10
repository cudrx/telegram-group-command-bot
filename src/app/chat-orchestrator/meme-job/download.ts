import { memeActionConfig } from '../../../config/runtime/index.js';
import { downloadMemeMediaToTemp } from '../../actions/meme/media-downloader.js';
import type {
  DownloadedMemeMedia,
  ResolvedMemeMedia
} from '../../actions/meme/types.js';
import { downloadRedditVideoWithYtDlp } from '../../actions/meme/yt-dlp-client.js';
import type { ProcessStatusReporter } from '../../process-status.js';
import type { ChatOrchestratorDeps } from '../types.js';

export async function downloadResolvedMedia(
  deps: ChatOrchestratorDeps,
  media: ResolvedMemeMedia,
  processStatus?: ProcessStatusReporter
): Promise<DownloadedMemeMedia> {
  if (media.kind === 'video' && media.downloadStrategy === 'yt-dlp') {
    const result = await downloadRedditVideoWithYtDlp({
      text: media.mediaUrl,
      sqlitePath: deps.env.sqlitePath,
      redditCookieHeaderPath: deps.env.redditCookieHeaderPath,
      redditCookiesPath: deps.env.redditCookiesPath,
      maxBytes: memeActionConfig.media.videoMaxBytes,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      ...(processStatus ? { processStatus } : {}),
      ...(deps.execFile ? { execFile: deps.execFile } : {})
    });

    if (!result) {
      throw new Error(
        `yt-dlp could not resolve Reddit video: ${media.mediaUrl}`
      );
    }

    return result.downloaded;
  }

  if (media.kind === 'gallery') {
    return downloadGalleryMedia(deps, media);
  }

  await processStatus?.stage('download');

  const downloaded = await downloadMemeMediaToTemp({
    url: media.mediaUrl,
    filename: `meme-media.${media.extension}`,
    maxBytes:
      media.kind === 'video'
        ? memeActionConfig.media.videoMaxBytes
        : memeActionConfig.media.imageMaxBytes,
    timeoutMs: memeActionConfig.media.downloadTimeoutMs,
    ...(deps.fetch ? { fetch: deps.fetch } : {})
  });

  if (media.kind === 'video') {
    return {
      kind: 'video',
      extension: media.extension,
      durationSeconds: media.durationSeconds ?? null,
      ...downloaded
    };
  }

  return {
    kind: 'image',
    extension: media.extension,
    ...downloaded
  };
}

export function getMemeChatAction(
  media: ResolvedMemeMedia
): 'upload_photo' | 'upload_video' {
  return media.kind === 'video' ? 'upload_video' : 'upload_photo';
}

async function downloadGalleryMedia(
  deps: ChatOrchestratorDeps,
  media: Extract<ResolvedMemeMedia, { kind: 'gallery' }>
): Promise<DownloadedMemeMedia> {
  const downloadedItems: Awaited<ReturnType<typeof downloadMemeMediaToTemp>>[] =
    [];

  try {
    for (const [index, item] of media.items.entries()) {
      const downloaded = await downloadMemeMediaToTemp({
        url: item.mediaUrl,
        filename: `meme-gallery-${index + 1}.${item.extension}`,
        maxBytes: memeActionConfig.media.imageMaxBytes,
        timeoutMs: memeActionConfig.media.downloadTimeoutMs,
        ...(deps.fetch ? { fetch: deps.fetch } : {})
      });
      downloadedItems.push(downloaded);
    }
  } catch (error) {
    await cleanupDownloadedItems(downloadedItems);
    throw error;
  }

  return {
    kind: 'gallery',
    items: media.items.map((item, index) => {
      const downloaded = downloadedItems[index];

      if (!downloaded) {
        throw new Error(`Gallery item ${index + 1} was not downloaded.`);
      }

      return {
        filePath: downloaded.filePath,
        extension: item.extension,
        ...(item.hasSpoiler ? { hasSpoiler: true } : {})
      };
    }),
    cleanup: async () => {
      await cleanupDownloadedItems(downloadedItems);
    }
  };
}

async function cleanupDownloadedItems(
  items: Array<{ cleanup: () => Promise<void> }>
): Promise<void> {
  await Promise.allSettled(items.map((item) => item.cleanup()));
}
