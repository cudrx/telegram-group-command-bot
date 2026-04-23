import type { LogLevel } from './types.js';

export function shouldColorizeLogs(forceColor: boolean | undefined): boolean {
  if (process.env.NO_COLOR !== undefined) {
    return false;
  }

  if (forceColor !== undefined) {
    return forceColor;
  }

  if (
    process.env.FORCE_COLOR !== undefined &&
    process.env.FORCE_COLOR !== '0'
  ) {
    return true;
  }

  return Boolean(process.stdout.isTTY || process.stderr.isTTY);
}

export function colorize(
  value: string,
  kind: LogLevel | 'label' | 'event',
  enabled: boolean
): string {
  if (!enabled) {
    return value;
  }

  const color = getAnsiColor(kind);

  return `\u001b[${color}m${value}\u001b[0m`;
}

function getAnsiColor(kind: LogLevel | 'label' | 'event'): string {
  switch (kind) {
    case 'debug':
      return '90';
    case 'info':
      return '36';
    case 'warn':
      return '33';
    case 'error':
      return '31';
    case 'label':
      return '90';
    case 'event':
      return '2';
  }
}
