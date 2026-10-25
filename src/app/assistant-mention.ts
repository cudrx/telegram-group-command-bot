import type { NormalizedMessage } from '../domain/models.js';

export function hasAssistantMention(
  message: NormalizedMessage,
  botUsername: string | null
): boolean {
  if (message.isBot || !botUsername) return false;

  const expected = `@${botUsername.toLowerCase()}`;

  return message.entities.some(
    (entity) =>
      entity.type === 'mention' &&
      message.text
        .slice(entity.offset, entity.offset + entity.length)
        .toLowerCase() === expected
  );
}
