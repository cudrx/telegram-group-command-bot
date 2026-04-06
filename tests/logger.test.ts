import { afterEach, describe, expect, test, vi } from "vitest";

import { createLogger, serializeError } from "../src/logging/logger.js";

describe("logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("prints multi-line readable error logs", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createLogger({
      service: "telegram-character-bot",
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
