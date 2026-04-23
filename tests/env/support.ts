import { parseEnv as parseRawEnv } from '../../src/config/env/index.js';

export { parseRawEnv };

export function parseEnv(rawEnv: Record<string, string | undefined>) {
  return parseRawEnv({
    TELEGRAM_CHAT_ID: '-1002155313986',
    TELEGRAM_ADMIN_ID: '-1002155313987',
    TAVILY_API_KEY: 'tvly-key',
    ...rawEnv
  });
}
