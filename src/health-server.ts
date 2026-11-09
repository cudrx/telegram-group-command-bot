import { createServer } from 'node:http';
import type { Transformer } from 'grammy';
import { healthConfig } from './config/runtime/index.js';

export function createPollingHealth(
  isRunning: () => boolean,
  now: () => number = Date.now
) {
  let lastSuccess: number | null = null;
  const transformer: Transformer = async (
    previous,
    method,
    payload,
    signal
  ) => {
    const response = await previous(method, payload, signal);
    if (method === 'getUpdates' && response.ok) lastSuccess = now();

    return response;
  };

  return {
    transformer,
    isHealthy: () =>
      isRunning() &&
      lastSuccess !== null &&
      now() - lastSuccess < healthConfig.pollingStaleMs
  };
}

export function createHealthServer(isHealthy: () => boolean) {
  return createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      const healthy = isHealthy();
      response.writeHead(healthy ? 200 : 503).end(healthy ? 'OK' : 'Not ready');
      return;
    }

    response.writeHead(404).end();
  });
}
