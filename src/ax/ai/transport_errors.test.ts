import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ax } from '../dsp/template.js';
import {
  AxAIServiceNetworkError,
  AxAIServiceStatusError,
  AxAIServiceTimeoutError,
} from '../util/apicall.js';
import { AxAIOpenAIModel } from './openai/chat_types.js';
import { AxAITypesafeClient } from './typesafe/client.js';
import { ai } from './wrap.js';

// How a real HTTP failure is typed and retried. The generated ports pin the
// same classification with their own HTTP clients against loopback servers.

const servers: Server[] = [];
const sockets: Socket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve()))
      )
  );
});

// A loopback server that hands each connection to `onConnection`.
const listen = async (onConnection: (socket: Socket) => void) => {
  const server = createServer((socket) => {
    sockets.push(socket);
    onConnection(socket);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return address.port;
};

// A port nothing listens on.
const closedPort = async () => {
  const port = await listen(() => {});
  await new Promise<void>((resolve) => servers.pop()?.close(() => resolve()));
  return port;
};

// Client options whose fetch counts the requests it sends; retries back off
// 10 ms.
const counted = (
  timeout?: number,
  retry: { maxRetries: number } = { maxRetries: 2 }
) => {
  let requests = 0;
  const options = {
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
      requests++;
      return fetch(input, init);
    }) as typeof fetch,
    ...(timeout === undefined ? {} : { timeout }),
    retry: { ...retry, initialDelayMs: 10, maxDelayMs: 20 },
  };
  return { options, requests: () => requests };
};

const client = (
  port: number,
  timeout?: number,
  retry?: { maxRetries: number }
) => {
  const { options, requests } = counted(timeout, retry);
  const service = ai({
    name: 'openai',
    apiKey: 'test',
    apiURL: `http://127.0.0.1:${port}/v1`,
    config: { model: AxAIOpenAIModel.GPT54Mini },
    options,
  });
  return { service, requests };
};

const chatPrompt = [{ role: 'user' as const, content: 'hi' }];

describe('a real HTTP failure', () => {
  it('is a retried network error when the connection is refused', async () => {
    const port = await closedPort();
    for (const stream of [false, true]) {
      const { service, requests } = client(port);
      const error = await service
        .chat({ chatPrompt }, { stream })
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(AxAIServiceNetworkError);
      expect((error as Error).message).toMatch(/^Network Error: /);
      // maxRetries 2: the first request and two retries.
      expect(requests()).toBe(3);
    }
  });

  it('is a retried network error when the server closes the connection without a response', async () => {
    const port = await listen((socket) => {
      socket.once('data', () => socket.destroy());
    });
    for (const stream of [false, true]) {
      const { service, requests } = client(port);
      const error = await service
        .chat({ chatPrompt }, { stream })
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(AxAIServiceNetworkError);
      expect((error as Error).message).toMatch(/^Network Error: /);
      expect(requests()).toBe(3);
    }
  });

  it('is a timeout error, not retried, when no response starts in time', async () => {
    const port = await listen(() => {});
    for (const stream of [false, true]) {
      const { service, requests } = client(port, 100);
      const error = await service
        .chat({ chatPrompt }, { stream })
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(AxAIServiceTimeoutError);
      expect(requests()).toBe(1);
    }
  });

  it('retries a 408 or 504 response by its status, as it is not a timeout the request ran out of', async () => {
    for (const [status, text] of [
      [408, 'Request Timeout'],
      [504, 'Gateway Timeout'],
    ] as const) {
      const body = JSON.stringify({ error: { message: 'upstream timed out' } });
      const port = await listen((socket) => {
        socket.once('data', () => {
          socket.end(
            `HTTP/1.1 ${status} ${text}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`
          );
        });
      });
      for (const stream of [false, true]) {
        const { service, requests } = client(port);
        const error = await service
          .chat({ chatPrompt }, { stream })
          .catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(AxAIServiceStatusError);
        expect((error as AxAIServiceStatusError).status).toBe(status);
        expect(requests()).toBe(3);
      }
    }
  });

  it('is a network error, not retried, when the connection drops after a stream started', async () => {
    const event = JSON.stringify({
      id: 'chatcmpl_drop',
      object: 'chat.completion.chunk',
      created: 0,
      model: 'gpt-5.4-mini',
      choices: [{ index: 0, delta: { content: 'Hel' }, finish_reason: null }],
    });
    const data = `data: ${event}\n\n`;
    const port = await listen((socket) => {
      socket.once('data', () => {
        socket.write(
          'HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n' +
            `${Buffer.byteLength(data).toString(16)}\r\n${data}\r\n`
        );
        setTimeout(() => socket.destroy(), 50);
      });
    });
    const { service, requests } = client(port);
    const stream = (await service.chat(
      { chatPrompt },
      { stream: true }
    )) as ReadableStream<unknown>;
    const reader = stream.getReader();
    const contents: unknown[] = [];
    const error = await (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        contents.push(value);
      }
    })().catch((caught: unknown) => caught);
    expect(contents).toHaveLength(1);
    expect(error).toBeInstanceOf(AxAIServiceNetworkError);
    expect((error as Error).message).toMatch(/^Network Error: /);
    expect(requests()).toBe(1);
  });
});

// The error, or the error it wraps, that is an instance of `type`.
const findCause = (
  error: unknown,
  type: abstract new (...args: never[]) => Error
) => {
  for (let current = error; current; current = (current as Error).cause) {
    if (current instanceof type) return current;
  }
  return undefined;
};

describe('an AxGen forward over a real HTTP failure', () => {
  // The client's own retries are off, so each request is one AxGen attempt.
  const noRequestRetry = { maxRetries: 0 };

  it('retries a network error as an infrastructure error', async () => {
    const port = await listen((socket) => {
      socket.once('data', () => socket.destroy());
    });
    for (const stream of [false, true]) {
      const { service, requests } = client(port, undefined, noRequestRetry);
      const error = await ax('question:string -> answer:string')
        .forward(service, { question: 'hi' }, { maxRetries: 1, stream })
        .catch((caught: unknown) => caught);
      expect(findCause(error, AxAIServiceNetworkError)).toBeDefined();
      // maxRetries 1: the first attempt and one infrastructure retry.
      expect(requests()).toBe(2);
    }
  });

  it('retries a timeout as an infrastructure error', async () => {
    const port = await listen(() => {});
    for (const stream of [false, true]) {
      const { service, requests } = client(port, 100, noRequestRetry);
      const error = await ax('question:string -> answer:string')
        .forward(service, { question: 'hi' }, { maxRetries: 1, stream })
        .catch((caught: unknown) => caught);
      expect(findCause(error, AxAIServiceTimeoutError)).toBeDefined();
      expect(requests()).toBe(2);
    }
  });
});

describe('a Typesafe request over a real HTTP failure', () => {
  const typesafe = (port: number, timeout?: number) => {
    const { options, requests } = counted(timeout);
    const service = new AxAITypesafeClient({
      apiKey: 'test',
      apiURL: `http://127.0.0.1:${port}`,
      options,
    });
    return { service, requests };
  };

  it('retries a network error', async () => {
    const port = await listen((socket) => {
      socket.once('data', () => socket.destroy());
    });
    const { service, requests } = typesafe(port);
    const error = await service.listModels().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AxAIServiceNetworkError);
    expect(requests()).toBe(3);
  });

  it('does not retry a timeout', async () => {
    const port = await listen(() => {});
    const { service, requests } = typesafe(port, 100);
    const error = await service.listModels().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AxAIServiceTimeoutError);
    expect(requests()).toBe(1);
  });
});
