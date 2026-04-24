import type { StoredMediaArtifact } from '../../database/index.js';
import type { StoredMessage } from '../../domain/models.js';
import { getPreferredMediaSummary } from '../chat-orchestrator/media/cache.js';
import type { WeeklyMessage } from './types.js';

export function getWeeklyPreferredMediaSummary(
  artifacts: StoredMediaArtifact[],
  message: Pick<StoredMessage, 'messageId' | 'mediaSnapshot'>
): string | null {
  if (!message.mediaSnapshot) {
    return null;
  }

  return getPreferredMediaSummary(
    artifacts,
    message.messageId,
    message.mediaSnapshot.mediaKind
  );
}

export function formatWeeklyMessageLine(message: WeeklyMessage): string {
  const author = message.senderDisplayName.trim() || 'Unknown';
  const parts = [`${message.createdAt} ${author}:`];
  const text = message.text.trim();
  const mediaText = formatWeeklyMediaText(message);

  if (text) {
    parts.push(text);
  }

  if (mediaText) {
    parts.push(mediaText);
  }

  return parts.join(' ');
}

function formatWeeklyMediaText(message: WeeklyMessage): string | null {
  const media = message.mediaSnapshot;

  if (!media) {
    return null;
  }

  const summary = message.mediaSummary?.trim();

  if (summary) {
    return `[${media.mediaKind}] ${summary}`;
  }

  const caption = media.caption?.trim();

  if (caption) {
    if (message.text.trim() === caption) {
      return null;
    }

    return `[${media.mediaKind}] ${caption}`;
  }

  return `[${media.mediaKind}]`;
}
