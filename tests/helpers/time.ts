export const NOW = '2026-04-03T12:00:00.000Z';

export function msAgo(ms: number): string {
  return new Date(Date.parse(NOW) - ms).toISOString();
}
