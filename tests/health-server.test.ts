import type { AddressInfo } from 'node:net';
import { expect, test } from 'vitest';

import { createHealthServer } from '../src/health-server.js';

test('GET /health returns HTTP 200', async () => {
  const server = createHealthServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const port = (server.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/health`);

    expect(response.status).toBe(200);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
