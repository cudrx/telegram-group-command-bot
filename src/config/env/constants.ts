import {
  lookupProviderConfig,
  mediaProviderConfig,
  storageConfig
} from '../runtime/index.js';

export const LOOKUP_PROVIDER = lookupProviderConfig.provider;
export const STT_PROVIDER = mediaProviderConfig.gladia.provider;
export const VISION_PROVIDER = mediaProviderConfig.cloudflareVision.provider;
export const MEDIA_MAX_FILE_BYTES = mediaProviderConfig.maxFileBytes;
export const MEDIA_ARTIFACT_RETENTION_DAYS =
  storageConfig.retention.mediaArtifactDays;
export const MESSAGE_RETENTION_DAYS = storageConfig.retention.messageDays;
export const DATABASE_CLEANUP_INTERVAL_HOURS =
  storageConfig.cleanup.databaseIntervalHours;
