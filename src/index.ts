import { createApplication } from './app.js';
import { getEnv } from './config/env/index.js';
import { createHealthServer } from './health-server.js';
import { logInfo } from './logging/logger.js';

const app = await createApplication(getEnv());
const healthServer = createHealthServer().listen(3000, '0.0.0.0');

const shutdown = (signal: string) => {
  logInfo('shutdown_signal_received', { signal });
  healthServer.close();

  void app.stop().finally(() => {
    process.exit(0);
  });
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

await app.start();
