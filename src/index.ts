import { createApplication } from './app.js';
import { getEnv } from './config/env.js';
import { logInfo } from './logging/logger.js';

const app = await createApplication(getEnv());

const shutdown = (signal: string) => {
  logInfo('shutdown_signal_received', { signal });

  void app.stop().finally(() => {
    process.exit(0);
  });
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

await app.start();
