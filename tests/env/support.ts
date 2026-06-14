import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseEnv as parseRawEnv } from '../../src/config/env/index.js';
import {
  createTestAccessConfig,
  createTestChatPolicy
} from '../helpers/telegram-fixtures.js';

export { parseRawEnv };

export function parseEnv(rawEnv: Record<string, string | undefined>) {
  return parseRawEnv({
    TELEGRAM_CHAT_CONFIG_PATH: writeChatConfigFile([createTestChatPolicy()]),
    TELEGRAM_ACCESS_CONFIG_PATH: writeAccessConfigFile(
      createTestAccessConfig()
    ),
    TAVILY_API_KEY: 'tvly-key',
    ...rawEnv
  });
}

export function writeChatConfigFile(policies: unknown): string {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), 'telegram-chat-config-')
  );
  const filePath = path.join(directory, 'telegram-chat-config.json');

  writeFileSync(filePath, JSON.stringify(policies), 'utf8');

  return filePath;
}

export function writeChatConfigTextFile(contents: string): string {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), 'telegram-chat-config-')
  );
  const filePath = path.join(directory, 'telegram-chat-config.json');

  writeFileSync(filePath, contents, 'utf8');

  return filePath;
}

export function writeAccessConfigFile(config: unknown): string {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), 'telegram-access-config-')
  );
  const filePath = path.join(directory, 'telegram-access-config.json');

  writeFileSync(filePath, JSON.stringify(config), 'utf8');

  return filePath;
}

export function writeAccessConfigTextFile(contents: string): string {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), 'telegram-access-config-')
  );
  const filePath = path.join(directory, 'telegram-access-config.json');

  writeFileSync(filePath, contents, 'utf8');

  return filePath;
}
