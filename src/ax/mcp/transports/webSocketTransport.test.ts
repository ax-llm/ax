import { describe, expect, it, vi } from 'vitest';

import type { AxMCPWebSocketLike } from './webSocketTransport.js';
import { AxMCPWebSocketTransport } from './webSocketTransport.js';

class FakeWebSocket implements AxMCPWebSocketLike {
  readyState = 0;
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
