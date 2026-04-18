import { describe, expect, test, vi } from "vitest";

import { maybeAnnounceDeployUpdate } from "../src/app/deploy-announcer.js";

describe("maybeAnnounceDeployUpdate", () => {
  test("skips when metadata is skipped", async () => {
    const deps = createDeps({
      loadDeployMetadata: () => ({
        status: "skipped",
        reason: "Deploy metadata file is missing."
      })
    });

    await maybeAnnounceDeployUpdate(deps);

    expect(deps.llm.formatDeployUpdate).not.toHaveBeenCalled();
    expect(deps.sendMessage).not.toHaveBeenCalled();
    expect(deps.logger.info).toHaveBeenCalledWith("deploy_announcement_skipped", {
      reason: "Deploy metadata file is missing."
    });
  });

  test("skips when sha was already announced", async () => {
    const deps = createDeps({
      getAppState: () => "sha-1"
    });

    await maybeAnnounceDeployUpdate(deps);

    expect(deps.llm.formatDeployUpdate).not.toHaveBeenCalled();
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });

  test("sends formatted update and stores sha after successful send", async () => {
    const deps = createDeps();

    await maybeAnnounceDeployUpdate(deps);

    expect(deps.llm.formatDeployUpdate).toHaveBeenCalledWith({
      shortSha: "sha-1",
      commits: ["fix: handle telegram media captions"]
    });
    expect(deps.sendMessage).toHaveBeenCalledWith({
      chatId: -1002155313986,
      text: "<b>Исправлено</b>\n\n• Подписи к видео теперь работают."
    });
    expect(deps.db.setAppState).toHaveBeenCalledWith(
      "last_announced_deploy_sha",
      "sha-1",
      "2026-04-19T10:00:00.000Z"
    );
  });

  test("logs and does not store sha when LLM fails", async () => {
    const deps = createDeps({
      formatDeployUpdate: vi.fn().mockRejectedValue(new Error("llm down"))
    });

    await maybeAnnounceDeployUpdate(deps);

    expect(deps.sendMessage).not.toHaveBeenCalled();
    expect(deps.db.setAppState).not.toHaveBeenCalled();
    expect(deps.logger.warn).toHaveBeenCalledWith(
      "deploy_announcement_failed",
      expect.objectContaining({
        errorMessage: "llm down"
      })
    );
  });
});

function createDeps(
  overrides: Partial<Parameters<typeof maybeAnnounceDeployUpdate>[0]> & {
    getAppState?: (key: string) => string | null;
    setAppState?: (key: string, value: string, updatedAt: string) => void;
    formatDeployUpdate?: ReturnType<typeof vi.fn>;
  } = {}
): Parameters<typeof maybeAnnounceDeployUpdate>[0] {
  const getAppState = overrides.getAppState ?? vi.fn().mockReturnValue(null);
  const setAppState = overrides.setAppState ?? vi.fn();
  const formatDeployUpdate =
    overrides.formatDeployUpdate ??
    vi.fn().mockResolvedValue({
      text: "<b>Исправлено</b>\n\n• Подписи к видео теперь работают.",
      model: "fast-reply-model",
      latencyMs: 10,
      attemptCount: 1,
      promptTokensEstimate: 20
    });

  return {
    deployNotifyChatId: -1002155313986,
    db: {
      getAppState,
      setAppState
    },
    llm: {
      formatDeployUpdate
    },
    loadDeployMetadata:
      overrides.loadDeployMetadata ??
      (() => ({
        status: "ok",
        metadata: {
          sha: "sha-1",
          shortSha: "sha-1",
          branch: "main",
          builtAt: "2026-04-19T09:59:00.000Z",
          commits: ["fix: handle telegram media captions"]
        }
      })),
    sendMessage: overrides.sendMessage ?? vi.fn().mockResolvedValue(undefined),
    logger:
      overrides.logger ??
      ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn()
      } as never),
    now: overrides.now ?? (() => "2026-04-19T10:00:00.000Z")
  };
}
