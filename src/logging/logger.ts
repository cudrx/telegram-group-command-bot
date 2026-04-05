export type LogFields = Record<string, unknown>;

export type AppLogger = {
  child(bindings: LogFields): AppLogger;
  info(event: string, payload?: LogFields): void;
  warn(event: string, payload?: LogFields): void;
  error(event: string, payload?: LogFields): void;
};

export function createLogger(bindings: LogFields = {}): AppLogger {
  return createStructuredLogger(bindings);
}

export function logInfo(
  event: string,
  payload: LogFields = {}
): void {
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

export function serializeError(error: unknown): LogFields {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack
    };
  }

  return {
    errorMessage: String(error)
  };
}

function createStructuredLogger(bindings: LogFields): AppLogger {
  return {
    child(childBindings) {
      return createStructuredLogger({
        ...bindings,
        ...childBindings
      });
    },

    info(event, payload = {}) {
      writeLog("info", event, bindings, payload);
    },

    warn(event, payload = {}) {
      writeLog("warn", event, bindings, payload);
    },

    error(event, payload = {}) {
      writeLog("error", event, bindings, payload);
    }
  };
}

function writeLog(
  level: "info" | "warn" | "error",
  event: string,
  bindings: LogFields,
  payload: LogFields
): void {
  const line = JSON.stringify({
    level,
    event,
    timestamp: new Date().toISOString(),
    ...bindings,
    ...payload
  });

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.info(line);
}
