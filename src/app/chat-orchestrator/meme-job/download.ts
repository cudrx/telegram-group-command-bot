import { memeActionConfig } from '../../../config/runtime/index.js';
import { downloadMemeMediaToTemp } from '../../actions/meme/media-downloader.js';
import type {
  DownloadedMemeMedia,
  ResolvedMemeMedia
} from '../../actions/meme/types.js';
import { downloadTelegramSafeVideoWithYtDlp } from '../../actions/meme/video-pipeline.js';
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
      maxBytes: memeActionConfig.telegramMedia.videoMaxBytes,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      ...(processStatus ? { processStatus } : {}),
      ...(deps.execFile ? { execFile: deps.execFile } : {})
    });

    if (!result) {
      throw new Error(`Reddit video could not be resolved: ${media.mediaUrl}`);
    }

    return result.downloaded;
  }

  if (media.kind === 'gallery') {
    return downloadGalleryMedia(deps, media, processStatus);
  }

  await processStatus?.stage('download');

  const downloaded = await downloadMemeMediaToTemp({
    url: media.mediaUrl,
    filename: `meme-media.${media.extension}`,
    maxBytes:
      media.kind === 'video' || media.kind === 'animation'
        ? memeActionConfig.telegramMedia.videoMaxBytes
        : memeActionConfig.telegramMedia.imageMaxBytes,
    timeoutMs: memeActionConfig.telegramMedia.downloadTimeoutMs,
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

  if (media.kind === 'animation') {
    return { kind: 'animation', extension: media.extension, ...downloaded };
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
  return media.kind === 'video' || media.kind === 'animation'
    ? 'upload_video'
    : 'upload_photo';
}

async function downloadGalleryMedia(
  deps: ChatOrchestratorDeps,
  media: Extract<ResolvedMemeMedia, { kind: 'gallery' }>,
  processStatus?: ProcessStatusReporter
): Promise<DownloadedMemeMedia> {
  const downloadedItems: Array<
    Exclude<DownloadedMemeMedia, { kind: 'gallery' | 'animation' }>
  > = [];

  try {
    for (const [index, item] of media.items.entries()) {
      if (item.kind === 'video') {
        const downloaded = await downloadTelegramSafeVideoWithYtDlp({
          url: item.mediaUrl,
          tempPrefix: `instagram-gallery-video-${index + 1}-`,
          maxBytes: memeActionConfig.telegramMedia.videoMaxBytes,
          maxDurationSeconds:
            memeActionConfig.telegramMedia.videoMaxDurationSeconds,
          ytDlpArgs: [],
          ...(processStatus ? { processStatus } : {}),
          ...(deps.execFile ? { execFile: deps.execFile } : {})
        });
        if (downloaded.kind !== 'video') {
          throw new Error(`Gallery item ${index + 1} did not produce video.`);
        }
        downloadedItems.push(downloaded);
        continue;
      }

      const downloaded = await downloadMemeMediaToTemp({
        url: item.mediaUrl,
        filename: `meme-gallery-${index + 1}.${item.extension}`,
        maxBytes: memeActionConfig.telegramMedia.imageMaxBytes,
        timeoutMs: memeActionConfig.telegramMedia.downloadTimeoutMs,
        ...(deps.fetch ? { fetch: deps.fetch } : {})
      });
      downloadedItems.push({
        kind: 'image',
        extension: item.extension,
        ...downloaded
      });
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

      if (downloaded.kind === 'video') {
        return {
          kind: 'video' as const,
          filePath: downloaded.filePath,
          extension: downloaded.extension,
          ...(downloaded.durationSeconds !== undefined
            ? { durationSeconds: downloaded.durationSeconds }
            : {}),
          ...(downloaded.width !== undefined
            ? { width: downloaded.width }
            : {}),
          ...(downloaded.height !== undefined
            ? { height: downloaded.height }
            : {}),
          ...(item.hasSpoiler ? { hasSpoiler: true } : {})
        };
      }

      return {
        filePath: downloaded.filePath,
        extension: downloaded.extension,
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
