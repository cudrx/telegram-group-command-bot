import { parseEnv as parseRawEnv } from '../../src/config/env/index.js';

export { parseRawEnv };

export function parseEnv(rawEnv: Record<string, string | undefined>) {
  return parseRawEnv({
    DEPLOY_NOTIFY_CHAT_ID: '-1002155313986',
    TAVILY_API_KEY: 'tvly-key',
    ...rawEnv
  });
}
