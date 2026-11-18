import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';

import { AxDockerSession } from '../index.js';

const fixture = async () => {
  const containers = [
    {
      Id: 'running',
      State: 'running',
      Labels: { 'com.example.tag': 'session' },
    },
    { Id: 'exited', State: 'exited', Labels: { 'com.example.tag': 'session' } },
    { Id: 'other', State: 'running', Labels: { 'com.example.tag': 'other' } },
  ];
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (path === '/containers/json') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(containers));
      return;
    }
    const container = containers.find((value) =>
      path.startsWith(`/containers/${value.Id}`)
    );
    if (container && path.endsWith('/stop')) {
      container.State = 'exited';
      response.writeHead(204).end();
    } else if (container && request.method === 'DELETE') {
      response.writeHead(container.State === 'running' ? 409 : 204).end();
    } else if (container && path.endsWith('/json')) {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ State: { Status: container.State } }));
    } else if (container && path.endsWith('/exec')) {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ Id: 'exec-1' }));
    } else if (path === '/exec/exec-1/start') {
      response.end('done');
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    session: new AxDockerSession(`http://127.0.0.1:${port}`),
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      ),
  };
};

describe('AxDockerSession Docker list states', () => {
  it('stops running containers with the selected tag', async () => {
    const { session, close } = await fixture();
    try {
      expect((await session.listContainers(true))[0]?.State).toBe('running');
      await expect(session.stopContainers({ tag: 'session' })).resolves.toEqual(
        [{ Id: 'running', Action: 'stopped' }]
      );
      expect(
        (await session.listContainers(true)).map((container) => container.State)
      ).toEqual(['exited', 'exited', 'running']);
    } finally {
      await close();
    }
  });

  it('stops running containers before removing them', async () => {
    const { session, close } = await fixture();
    try {
      await expect(
        session.stopContainers({ tag: 'session', remove: true })
      ).resolves.toEqual([
        { Id: 'running', Action: 'stopped' },
        { Id: 'running', Action: 'removed' },
        { Id: 'exited', Action: 'removed' },
      ]);
    } finally {
      await close();
    }
  });

  it('keeps unmatched containers untouched', async () => {
    const { session, close } = await fixture();
    try {
      await expect(
        session.stopContainers({ tag: 'absent', remove: true })
      ).resolves.toEqual([]);
      expect((await session.listContainers(true))[0]?.State).toBe('running');
    } finally {
      await close();
    }
  });

  it('retains object-shaped inspect states for command execution', async () => {
    const { session, close } = await fixture();
    try {
      await session.connectToContainer('running');
      await expect(session.executeCommand('printf done')).resolves.toBe('done');
    } finally {
      await close();
    }
  });
});
