import type { LlmReplyResult } from '../llm/openai-compatible-llm-client.js';
import { type AppLogger, serializeError } from '../logging/logger.js';
import {
  type DeployMetadataLoadResult,
  loadDeployMetadata as defaultLoadDeployMetadata
} from './deploy-metadata.js';
import { formatTelegramHtmlReply } from './telegram-html.js';

const LAST_ANNOUNCED_DEPLOY_SHA_KEY = 'last_announced_deploy_sha';

export async function maybeAnnounceDeployUpdate(input: {
  deployNotifyChatId: number;
  db: {
    getAppState(key: string): string | null;
    setAppState(key: string, value: string, updatedAt: string): void;
  };
  llm: {
    formatDeployUpdate(input: {
      shortSha: string;
      commits: string[];
    }): Promise<LlmReplyResult>;
  };
  loadDeployMetadata?: () => DeployMetadataLoadResult;
  sendMessage(input: { chatId: number; text: string }): Promise<void>;
  logger: AppLogger;
  now: () => string;
}): Promise<void> {
  const loaded = (input.loadDeployMetadata ?? defaultLoadDeployMetadata)();

  if (loaded.status === 'skipped') {
    input.logger.info('deploy_announcement_skipped', {
      reason: loaded.reason
    });
    return;
  }

  const lastAnnouncedSha = input.db.getAppState(LAST_ANNOUNCED_DEPLOY_SHA_KEY);

  if (lastAnnouncedSha === loaded.metadata.sha) {
    input.logger.debug('deploy_announcement_skipped_duplicate', {
      sha: loaded.metadata.sha
    });
    return;
  }

  try {
    const result = await input.llm.formatDeployUpdate({
      shortSha: loaded.metadata.shortSha,
      commits: loaded.metadata.commits
    });
    const text = formatTelegramHtmlReply(result.text);

    await input.sendMessage({
      chatId: input.deployNotifyChatId,
      text
    });
    input.db.setAppState(
      LAST_ANNOUNCED_DEPLOY_SHA_KEY,
      loaded.metadata.sha,
      input.now()
    );
    input.logger.info('deploy_announcement_sent', {
      sha: loaded.metadata.sha,
      commitCount: loaded.metadata.commits.length,
      llmModel: result.model,
      llmLatencyMs: result.latencyMs,
      llmAttempts: result.attemptCount
    });
  } catch (error) {
    input.logger.warn('deploy_announcement_failed', {
      sha: loaded.metadata.sha,
      ...serializeError(error)
    });
  }
}
