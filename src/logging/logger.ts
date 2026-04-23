import { serializeError } from './logger/errors.js';
import { createStructuredLogger } from './logger/structured.js';
import type { AppLogger, LogFields, LoggerOptions } from './logger/types.js';

export { serializeError } from './logger/errors.js';
export type {
  AppLogger,
  LogFields,
  LoggerOptions,
  LogLevel
} from './logger/types.js';

export function createLogger(
  bindings: LogFields = {},
  options: LoggerOptions = {}
): AppLogger {
  return createStructuredLogger(bindings, options);
}

export function logInfo(event: string, payload: LogFields = {}): void {
  createLogger().info(event, payload);
}

export function logError(
  event: string,
  error: unknown,
  payload: LogFields = {}
): void {
  createLogger().error(event, {
    ...payload,
    ...serializeError(error)
  });
}
