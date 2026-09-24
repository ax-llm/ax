import { describe, expect, it, vi } from 'vitest';

import type { AxMCPWebSocketLike } from './webSocketTransport.js';
import { AxMCPWebSocketTransport } from './webSocketTransport.js';

class FakeWebSocket implements AxMCPWebSocketLike {
  readyState = 0;
  binaryType = 'blob';
  sent: string[] = [];
  sendError?: Error;
  private listeners = new Map<string, ((event: any) => void)[]>();

  send(data: string): void {
    if (this.sendError) throw this.sendError;
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
    this.emit('close', {});
  }
  addEventListener(type: string, listener: (event: any) => void): void {
    const values = this.listeners.get(type) ?? [];
    values.push(listener);
    this.listeners.set(type, values);
  }
  open(): void {
    this.readyState = 1;
    this.emit('open', {});
  }
  receive(value: unknown): void {
    this.emit('message', { data: JSON.stringify(value) });
  }
  // Like browsers and Node's global WebSocket: binary frames arrive as a Blob
  // unless binaryType is 'arraybuffer'.
  receiveBinary(value: unknown): void {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    this.receiveData(
      this.binaryType === 'arraybuffer' ? bytes.buffer : new Blob([bytes])
    );
  }
  receiveData(data: unknown): void {
    this.emit('message', { data });
  }
  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe('AxMCPWebSocketTransport', () => {
  it('multiplexes JSON-RPC responses over a custom WebSocket', async () => {
    const socket = new FakeWebSocket();
    const transport = new AxMCPWebSocketTransport('wss://mcp.example', {
      webSocketFactory: () => socket,
    });
    expect(transport.eraHint).toBe('legacy');
    const connected = transport.connect();
    socket.open();
    await connected;

    const pending = transport.send({
      jsonrpc: '2.0',
      id: 'one',
      method: 'tools/list',
    });
    socket.receive({ jsonrpc: '2.0', id: 'one', result: { tools: [] } });

    await expect(pending).resolves.toMatchObject({ id: 'one' });
    expect(JSON.parse(socket.sent[0]!)).toMatchObject({ method: 'tools/list' });
  });

  it('reads JSON-RPC messages from binary frames', async () => {
    const socket = new FakeWebSocket();
    const transport = new AxMCPWebSocketTransport('wss://mcp.example', {
      webSocketFactory: () => socket,
    });
    const received: unknown[] = [];
    transport.setMessageHandler((message) => {
      received.push(message);
    });
    const connected = transport.connect();
    socket.open();
    await connected;

    const pending = transport.send({
      jsonrpc: '2.0',
      id: 'one',
      method: 'tools/list',
    });
    const log = {
      jsonrpc: '2.0',
      method: 'notifications/message',
      params: { level: 'info', data: 'café ☕' },
    };
    socket.receiveBinary(log);
    socket.receiveBinary({ jsonrpc: '2.0', id: 'one', result: { tools: [] } });

    await expect(pending).resolves.toMatchObject({ id: 'one' });
    expect(received).toEqual([log]);
  });

  it('reads a binary frame delivered as a view into a larger buffer', async () => {
    const socket = new FakeWebSocket();
    const transport = new AxMCPWebSocketTransport('wss://mcp.example', {
      webSocketFactory: () => socket,
    });
    const connected = transport.connect();
    socket.open();
    await connected;

    const pending = transport.send({
      jsonrpc: '2.0',
      id: 'one',
      method: 'tools/list',
    });
    const bytes = new TextEncoder().encode(
      JSON.stringify({ jsonrpc: '2.0', id: 'one', result: { tools: [] } })
    );
    const pooled = new Uint8Array(bytes.length + 8);
    pooled.set(bytes, 4);
    socket.receiveData(pooled.subarray(4, 4 + bytes.length));

    await expect(pending).resolves.toMatchObject({ id: 'one' });
  });

  it('names binary data it cannot read synchronously', async () => {
    const socket = new FakeWebSocket();
    const transport = new AxMCPWebSocketTransport('wss://mcp.example', {
      webSocketFactory: () => socket,
    });
    const connected = transport.connect();
    socket.open();
    await connected;
    // A wrapper socket that does not pass binaryType on to the real one.
    socket.binaryType = 'blob';

    expect(() =>
      socket.receiveBinary({ jsonrpc: '2.0', method: 'notifications/ping' })
    ).toThrow('Cannot read an MCP WebSocket message delivered as Blob');
  });

  it('sends a single legacy batch and correlates concurrent responses', async () => {
    const socket = new FakeWebSocket();
    const transport = new AxMCPWebSocketTransport('wss://mcp.example', {
      webSocketFactory: () => socket,
    });
    const connected = transport.connect();
    socket.open();
    await connected;
    transport.setProtocolVersion('2025-03-26');

    const pending = transport.sendBatch([
      { jsonrpc: '2.0', id: 'one', method: 'tools/list' },
      { jsonrpc: '2.0', id: 'two', method: 'prompts/list' },
    ]);
    expect(JSON.parse(socket.sent[0]!)).toHaveLength(2);
    socket.receive([
      { jsonrpc: '2.0', id: 'two', result: { prompts: [] } },
      { jsonrpc: '2.0', id: 'one', result: { tools: [] } },
    ]);

    await expect(pending).resolves.toEqual([
      { jsonrpc: '2.0', id: 'one', result: { tools: [] } },
      { jsonrpc: '2.0', id: 'two', result: { prompts: [] } },
    ]);
  });

  it('exposes unexpected disconnects through the listening handle', async () => {
    const socket = new FakeWebSocket();
    const transport = new AxMCPWebSocketTransport('wss://mcp.example', {
      webSocketFactory: () => socket,
    });
    const listeningPromise = transport.startListening();
    socket.open();
    const listening = await listeningPromise;
    socket.close();
    await expect(listening.done).rejects.toThrow('MCP WebSocket closed');
  });

  it('removes a pending request abort listener on disconnect', async () => {
    const socket = new FakeWebSocket();
    const transport = new AxMCPWebSocketTransport('wss://mcp.example', {
      webSocketFactory: () => socket,
    });
    const listeningPromise = transport.startListening();
    socket.open();
    const listening = await listeningPromise;
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');

    const pending = transport.send(
      { jsonrpc: '2.0', id: 'one', method: 'tools/list' },
      { signal: controller.signal }
    );
    socket.close();

    await expect(pending).rejects.toThrow('MCP WebSocket closed');
    await expect(listening.done).rejects.toThrow('MCP WebSocket closed');
    expect(removeListener).toHaveBeenCalledOnce();
  });

  it('cleans up a request when WebSocket.send throws', async () => {
    const socket = new FakeWebSocket();
    const transport = new AxMCPWebSocketTransport('wss://mcp.example', {
      webSocketFactory: () => socket,
    });
    const connected = transport.connect();
    socket.open();
    await connected;
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const sendError = new Error('send failed');
    socket.sendError = sendError;

    await expect(
      transport.send(
        { jsonrpc: '2.0', id: 'one', method: 'tools/list' },
        { signal: controller.signal }
      )
    ).rejects.toBe(sendError);
    expect(removeListener).toHaveBeenCalledOnce();

    socket.sendError = undefined;
    const retry = transport.send({
      jsonrpc: '2.0',
      id: 'one',
      method: 'tools/list',
    });
    socket.receive({ jsonrpc: '2.0', id: 'one', result: { tools: [] } });
    await expect(retry).resolves.toMatchObject({ id: 'one' });
  });

  it('cleans up every batch request when WebSocket.send throws', async () => {
    const socket = new FakeWebSocket();
    const transport = new AxMCPWebSocketTransport('wss://mcp.example', {
      webSocketFactory: () => socket,
    });
    const connected = transport.connect();
    socket.open();
    await connected;
    transport.setProtocolVersion('2025-03-26');
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const sendError = new Error('batch send failed');
    socket.sendError = sendError;

    await expect(
      transport.sendBatch(
        [
          { jsonrpc: '2.0', id: 'one', method: 'tools/list' },
          { jsonrpc: '2.0', id: 'two', method: 'prompts/list' },
        ],
        { signal: controller.signal }
      )
    ).rejects.toBe(sendError);
    expect(removeListener).toHaveBeenCalledTimes(2);
  });
});
