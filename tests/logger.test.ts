import { afterEach, describe, expect, test, vi } from "vitest";

import { createLogger, serializeError } from "../src/logging/logger.js";

describe("logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("prints multi-line readable error logs", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createLogger({
      service: "telegram-assistant-bot",
      nodeEnv: "development"
    });

    logger.error("reply_job_failed", {
      errorMessage: "temporary failure",
      errorCode: "ECONNRESET",
      chatId: 42,
      request: {
        model: "reply-model"
      }
    });

    expect(errorSpy).toHaveBeenCalledTimes(1);

    const output = errorSpy.mock.calls[0]?.[0];

    expect(output).toContain("ERROR reply_job_failed");
    expect(output).toContain("\nerror: temporary failure");
    expect(output).toContain("\ncode: ECONNRESET");
    expect(output).toContain("\nchatId: 42");
    expect(output).toContain("\nrequest:");
    expect(output).toContain('"model": "reply-model"');
  });

  test("adds readable ANSI color when forced and disables it with NO_COLOR", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const originalForceColor = process.env.FORCE_COLOR;
    const originalNoColor = process.env.NO_COLOR;

    try {
      process.env.FORCE_COLOR = "1";
      delete process.env.NO_COLOR;

      createLogger().info("llm.reply.request", {
        chatId: 42,
        prompt: "hello"
      });

      process.env.NO_COLOR = "1";

      createLogger().info("llm.reply.response", {
        chatId: 42,
        response: "hi"
      });
    } finally {
      if (originalForceColor === undefined) {
        delete process.env.FORCE_COLOR;
      } else {
        process.env.FORCE_COLOR = originalForceColor;
      }

      if (originalNoColor === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = originalNoColor;
      }
    }

    const coloredOutput = infoSpy.mock.calls[0]?.[0];
    const plainOutput = infoSpy.mock.calls[1]?.[0];

    expect(coloredOutput).toContain("\u001b[");
    expect(coloredOutput).toContain("INFO");
    expect(plainOutput).not.toContain("\u001b[");
    expect(plainOutput).toContain("INFO llm.reply.response");
  });

  test("suppresses debug logs at info level", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const logger = createLogger({}, { level: "info" });

    logger.debug("telegram_update_received", {
      messageId: 42
    });
    logger.info("bot_initialized", {
      botUsername: "hrupa_bot"
    });

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy.mock.calls[0]?.[0]).toContain("INFO bot_initialized");
  });

  test("can color logs without a TTY when enabled", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const originalNoColor = process.env.NO_COLOR;

    try {
      delete process.env.NO_COLOR;

      createLogger({}, { color: true }).info("bot_initialized");
    } finally {
      if (originalNoColor === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = originalNoColor;
      }
    }

    expect(infoSpy.mock.calls[0]?.[0]).toContain("\u001b[");
  });

  test("extracts optional status and code from error objects", () => {
    const error = new Error("provider failed") as Error & {
      code?: string;
      status?: number;
    };

    error.code = "ECONNRESET";
    error.status = 503;

    expect(serializeError(error)).toMatchObject({
      errorMessage: "provider failed",
      errorCode: "ECONNRESET",
      errorStatus: 503
    });
  });
});
