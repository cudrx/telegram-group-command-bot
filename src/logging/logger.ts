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
    const errorWithFields = error as Error & {
      code?: unknown;
      status?: unknown;
    };

    return {
      errorName: error.name,
      errorMessage: error.message,
      ...(typeof errorWithFields.code === "string"
        ? {
            errorCode: errorWithFields.code
          }
        : {}),
      ...(typeof errorWithFields.status === "number"
        ? {
            errorStatus: errorWithFields.status
          }
        : {}),
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
  const line = formatPrettyLog(level, event, {
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

function formatPrettyLog(
  level: "info" | "warn" | "error",
  event: string,
  fields: LogFields
): string {
  const useColor = shouldColorizeLogs();
  const entries = Object.entries(fields);
  const timestamp = typeof fields.timestamp === "string"
    ? fields.timestamp
    : new Date().toISOString();
  const body = entries
    .filter(([key]) => key !== "timestamp")
    .sort(([left], [right]) => compareLogKeys(left, right))
    .flatMap(([key, value]) => formatLogField(key, value, useColor));

  const lines = [formatLogHeader(timestamp, level, event, useColor)];

  if (body.length > 0) {
    lines.push("", ...body);
  }

  lines.push("");

  return lines.join("\n");
}

function compareLogKeys(left: string, right: string): number {
  return getLogKeyPriority(left) - getLogKeyPriority(right) || left.localeCompare(right);
}

function getLogKeyPriority(key: string): number {
  switch (key) {
    case "chatId":
      return 0;
    case "messageId":
      return 1;
    case "correlationId":
      return 2;
    case "errorMessage":
      return 3;
    case "errorCode":
      return 4;
    case "errorStatus":
      return 5;
    case "errorName":
      return 6;
    case "service":
      return 7;
    case "nodeEnv":
      return 8;
    case "kind":
      return 9;
    case "model":
      return 10;
    case "temperature":
      return 11;
    case "latencyMs":
      return 12;
    case "attemptCount":
      return 13;
    case "promptTokensEstimate":
      return 14;
    case "prompt":
      return 90;
    case "response":
      return 91;
    default:
      return 10;
  }
}

function formatLogField(key: string, value: unknown, useColor: boolean): string[] {
  const label = colorize(toLogLabel(key), "label", useColor);

  if (value === undefined) {
    return [];
  }

  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return [`${label}: ${String(value)}`];
  }

  if (typeof value === "string") {
    if (value.includes("\n")) {
      return [label + ":", indentMultiline(value)];
    }

    return [`${label}: ${value}`];
  }

  return [
    label + ":",
    JSON.stringify(value, null, 2)
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n")
  ];
}

function formatLogHeader(
  timestamp: string,
  level: "info" | "warn" | "error",
  event: string,
  useColor: boolean
): string {
  const renderedLevel = colorize(level.toUpperCase(), level, useColor);
  const renderedEvent = colorize(event, "event", useColor);

  return `[${timestamp}] ${renderedLevel} ${renderedEvent}`;
}

function shouldColorizeLogs(): boolean {
  if (process.env.NO_COLOR !== undefined) {
    return false;
  }

  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== "0") {
    return true;
  }

  return Boolean(process.stdout.isTTY || process.stderr.isTTY);
}

function colorize(
  value: string,
  kind: "info" | "warn" | "error" | "label" | "event",
  enabled: boolean
): string {
  if (!enabled) {
    return value;
  }

  const color = getAnsiColor(kind);

  return `\u001b[${color}m${value}\u001b[0m`;
}

function getAnsiColor(
  kind: "info" | "warn" | "error" | "label" | "event"
): string {
  switch (kind) {
    case "info":
      return "36";
    case "warn":
      return "33";
    case "error":
      return "31";
    case "label":
      return "90";
    case "event":
      return "2";
  }
}

function toLogLabel(key: string): string {
  switch (key) {
    case "errorMessage":
      return "error";
    case "errorCode":
      return "code";
    case "errorStatus":
      return "status";
    case "errorName":
      return "name";
    default:
      return key;
  }
}

function indentMultiline(value: string): string {
  return value
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}
