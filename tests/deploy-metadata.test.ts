import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { loadDeployMetadata } from "../src/app/deploy-metadata.js";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("loadDeployMetadata", () => {
  test("loads valid deploy metadata", () => {
    const filePath = writeMetadata({
      sha: "9c59b85d123",
      shortSha: "9c59b85",
      branch: "main",
      builtAt: "2026-04-19T10:00:00.000Z",
      commits: ["fix: handle telegram media captions"]
    });

    expect(loadDeployMetadata(filePath)).toEqual({
      status: "ok",
      metadata: {
        sha: "9c59b85d123",
        shortSha: "9c59b85",
        branch: "main",
        builtAt: "2026-04-19T10:00:00.000Z",
        commits: ["fix: handle telegram media captions"]
      }
    });
  });

  test("skips missing metadata files", () => {
    expect(loadDeployMetadata("/tmp/does-not-exist/deploy-metadata.json")).toEqual({
      status: "skipped",
      reason: "Deploy metadata file is missing."
    });
  });

  test("skips unknown sha", () => {
    const filePath = writeMetadata({
      sha: "unknown",
      shortSha: "unknown",
      branch: "main",
      builtAt: null,
      commits: ["fix: something"]
    });

    expect(loadDeployMetadata(filePath)).toEqual({
      status: "skipped",
      reason: "Deploy metadata sha is unknown."
    });
  });

  test("skips empty commit lists", () => {
    const filePath = writeMetadata({
      sha: "9c59b85d123",
      shortSha: "9c59b85",
      branch: "main",
      builtAt: "2026-04-19T10:00:00.000Z",
      commits: []
    });

    expect(loadDeployMetadata(filePath)).toEqual({
      status: "skipped",
      reason: "Deploy metadata has no commits."
    });
  });
});

function writeMetadata(value: unknown): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "deploy-metadata-"));
  tempDirectories.push(directory);
  const filePath = path.join(directory, "deploy-metadata.json");

  writeFileSync(filePath, JSON.stringify(value), "utf8");

  return filePath;
}
