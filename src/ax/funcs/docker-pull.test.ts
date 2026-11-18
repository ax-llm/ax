import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';

import { AxDockerSession } from '../index.js';

const fixture = async (body: string, status = 200) => {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    requests.push(path);
    response.setHeader('Content-Type', 'application/json');
    if (path === '/images/create') {
      response.writeHead(status);
      // A transport chunk can end in the middle of a JSON record.
      const split = Math.floor(body.length / 2);
      response.write(body.slice(0, split));
      response.end(body.slice(split));
    } else if (path === '/containers/create') {
      response
        .writeHead(201)
        .end(JSON.stringify({ Id: 'cached-image-container' }));
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    session: new AxDockerSession(`http://127.0.0.1:${port}`),
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      ),
  };
};

const progress = '{"status":"Pulling fs layer","id":"layer-1"}\r\n';

describe('AxDockerSession image pull results', () => {
  it.each([
    ['{"errorDetail":{"message":"digest mismatch"}}', 'digest mismatch'],
    ['{"error":"legacy pull failure"}', 'legacy pull failure'],
    [
      '{"error":"legacy text","errorDetail":{"message":"detailed pull failure"}}',
      'detailed pull failure',
    ],
  ])(
    'rejects a successful HTTP response carrying %s',
    async (error, message) => {
      const { session, close } = await fixture(`${progress}${error}\n`);
      try {
        await expect(session.pullImage('example:latest')).rejects.toThrow(
          message
        );
      } finally {
        await close();
      }
    }
  );

  it('does not create a container after a streamed pull failure', async () => {
    const { session, requests, close } = await fixture(
      `${progress}{"errorDetail":{"message":"registry connection lost"}}\n`
    );
    try {
      await expect(
        session.createContainer({ imageName: 'example:latest' })
      ).rejects.toThrow('registry connection lost');
      expect(requests).toEqual(['/images/create']);
    } finally {
      await close();
    }
  });

  it('accepts progress records and creates the container after a successful pull', async () => {
    const { session, requests, close } = await fixture(
      `${progress}\n{"status":"Download complete","id":"layer-1"}\n`
    );
    try {
      await expect(
        session.createContainer({ imageName: 'example:latest' })
      ).resolves.toEqual({ Id: 'cached-image-container' });
      expect(requests).toEqual(['/images/create', '/containers/create']);
    } finally {
      await close();
    }
  });

  it('continues to reject an HTTP error', async () => {
    const { session, close } = await fixture('{"message":"server error"}', 500);
    try {
      await expect(session.pullImage('example:latest')).rejects.toThrow(
        'Failed to pull image: Internal Server Error'
      );
    } finally {
      await close();
    }
  });

  it('preserves empty-body success', async () => {
    const { session, close } = await fixture('');
    try {
      await expect(
        session.pullImage('example:latest')
      ).resolves.toBeUndefined();
    } finally {
      await close();
    }
  });
});
