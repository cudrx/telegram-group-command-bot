import { createServer } from 'node:http';

export function createHealthServer() {
  return createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200).end('OK');
      return;
    }

    response.writeHead(404).end();
  });
}
