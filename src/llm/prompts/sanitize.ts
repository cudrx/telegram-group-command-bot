export function sanitizePromptText(value: string): string {
  return value
    .replace(/```/g, '[triple-backticks]')
    .replace(/\r?\n+/g, ' \\n ')
    .replace(
      /\b(BEGIN|END) (CHAT TRANSCRIPT|LOOKUP SOURCES)\b/gi,
      (match) => `[quoted-${match.toUpperCase()}]`
    )
    .replace(
      /\b(system|assistant|developer|user)\s*:/gi,
      (_match, role: string) => `[quoted-${role.toLowerCase()}-marker]`
    )
    .replace(/"/g, '\\"')
    .trim();
}

export function formatJsonForPrompt(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .replace(/```/g, '[triple-backticks]')
    .replace(
      /\b(BEGIN|END) (CHAT TRANSCRIPT|LOOKUP SOURCES)\b/gi,
      (match) => `[quoted-${match.toUpperCase()}]`
    )
    .replace(
      /\b(system|assistant|developer|user)\s*:/gi,
      (_match, role: string) => `[quoted-${role.toLowerCase()}-marker]`
    );
}
