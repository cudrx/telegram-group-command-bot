export type LogFields = Record<string, unknown>;
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LoggerOptions = {
  level?: LogLevel;
  color?: boolean;
};

export type AppLogger = {
  child(bindings: LogFields): AppLogger;
  debug(event: string, payload?: LogFields): void;
  info(event: string, payload?: LogFields): void;
  warn(event: string, payload?: LogFields): void;
  error(event: string, payload?: LogFields): void;
};
