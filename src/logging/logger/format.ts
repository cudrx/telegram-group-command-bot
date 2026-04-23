import { colorize, shouldColorizeLogs } from './colors.js';
import type { LogFields, LoggerOptions, LogLevel } from './types.js';

export function formatPrettyLog(
  level: LogLevel,
  event: string,
  fields: LogFields,
  options: LoggerOptions
): string {
  const useColor = shouldColorizeLogs(options.color);
  const entries = Object.entries(fields);
  const timestamp =
    typeof fields.timestamp === 'string'
      ? fields.timestamp
      : new Date().toISOString();
  const body = entries
    .filter(([key]) => key !== 'timestamp')
    .sort(([left], [right]) => compareLogKeys(left, right))
    .flatMap(([key, value]) => formatLogField(key, value, useColor));

  const lines = [formatLogHeader(timestamp, level, event, useColor)];

  if (body.length > 0) {
    lines.push('', ...body);
  }

  lines.push('');

  return lines.join('\n');
}

function compareLogKeys(left: string, right: string): number {
  return (
    getLogKeyPriority(left) - getLogKeyPriority(right) ||
    left.localeCompare(right)
  );
}

function getLogKeyPriority(key: string): number {
  switch (key) {
    case 'chatId':
      return 0;
    case 'messageId':
      return 1;
    case 'correlationId':
      return 2;
    case 'errorMessage':
      return 3;
    case 'errorCode':
      return 4;
    case 'errorStatus':
      return 5;
    case 'errorName':
      return 6;
    case 'service':
      return 7;
    case 'nodeEnv':
      return 8;
    case 'kind':
      return 9;
    case 'model':
      return 10;
    case 'temperature':
      return 11;
    case 'latencyMs':
      return 12;
    case 'attemptCount':
      return 13;
    case 'promptTokensEstimate':
      return 14;
    case 'prompt':
      return 90;
    case 'response':
      return 91;
    default:
      return 10;
  }
}

function formatLogField(
  key: string,
  value: unknown,
  useColor: boolean
): string[] {
  const label = colorize(toLogLabel(key), 'label', useColor);

  if (value === undefined) {
    return [];
  }

  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return [`${label}: ${String(value)}`];
  }

  if (typeof value === 'string') {
    if (value.includes('\n')) {
      return [`${label}:`, indentMultiline(value)];
    }

    return [`${label}: ${value}`];
  }

  return [
    `${label}:`,
    JSON.stringify(value, null, 2)
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n')
  ];
}

function formatLogHeader(
  timestamp: string,
  level: LogLevel,
  event: string,
  useColor: boolean
): string {
  const renderedLevel = colorize(level.toUpperCase(), level, useColor);
  const renderedEvent = colorize(event, 'event', useColor);

  return `[${timestamp}] ${renderedLevel} ${renderedEvent}`;
}

function toLogLabel(key: string): string {
  switch (key) {
    case 'errorMessage':
      return 'error';
    case 'errorCode':
      return 'code';
    case 'errorStatus':
      return 'status';
    case 'errorName':
      return 'name';
    default:
      return key;
  }
}

function indentMultiline(value: string): string {
  return value
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}
