import type { AddressInfo } from 'node:net';
import { expect, test } from 'vitest';

import { createHealthServer } from '../src/health-server.js';

test('GET /health returns HTTP 200', async () => {
  const server = createHealthServer(() => true);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const port = (server.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/health`);

    expect(response.status).toBe(200);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('GET /health follows polling readiness instead of HTTP server availability', async () => {
  let healthy = false;
  const server = createHealthServer(() => healthy);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect((await fetch(`${url}/health`)).status).toBe(503);
    healthy = true;
    expect((await fetch(`${url}/health`)).status).toBe(200);
    healthy = false;
    expect((await fetch(`${url}/health`)).status).toBe(503);
    expect((await fetch(`${url}/unknown`)).status).toBe(404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
