export function getTelegramRetryAfterSeconds(error: unknown): number | null {
  const structuredRetryAfterSeconds = readStructuredRetryAfter(error);
  if (structuredRetryAfterSeconds !== null) {
    return structuredRetryAfterSeconds;
  }

  const message = toErrorMessage(error);
  const match = message.match(/\bretry after (\d+)\b/i);
  if (!match) {
    return null;
  }

  const retryAfterSeconds = Number.parseInt(match[1] ?? '', 10);

  return Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : null;
}

function readStructuredRetryAfter(error: unknown): number | null {
  if (!isRecord(error)) {
    return null;
  }

  const parameters = error.parameters;
  if (!isRecord(parameters)) {
    return null;
  }

  const retryAfter = parameters.retry_after;

  return typeof retryAfter === 'number' && Number.isFinite(retryAfter)
    ? retryAfter
    : null;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
