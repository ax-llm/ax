import { describe, expect, it, vi } from 'vitest';
import { ai } from '../wrap.js';
import {
  AxAIOpenAIResponsesClient,
  type AxAIOpenAIResponsesSocket,
} from './responses_client.js';
import { AxAIOpenAIResponsesModel } from './responses_types.js';

const model = AxAIOpenAIResponsesModel.GPT6Astra;
const response = (id = 'r1') => ({
  id,
  model,
  status: 'completed',
  output: [],
  usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
});
class Socket implements AxAIOpenAIResponsesSocket {
  listeners = new Map<string, Set<(event: any) => void>>();
  sent: any[] = [];
  closes = 0;
  addEventListener(type: string, listener: (event: any) => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: (event: any) => void) {
    this.listeners.get(type)?.delete(listener);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closes++;
  }
  emit(type: string, event: any = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  event(value: unknown) {
    this.emit('message', { data: JSON.stringify(value) });
  }
}
function client(fetch?: typeof globalThis.fetch) {
  return new AxAIOpenAIResponsesClient({
    apiKey: 'test',
    defaults: { model, reasoning: { effort: 'low' } },
    options: () => ({ fetch }),
    estimateCost: () => 0,
  });
}
async function connected(options = {}) {
  const api = client();
  const socket = new Socket();
  const promise = api.connect({
    ...options,
    webSocketFactory: () => {
      queueMicrotask(() => socket.emit('open'));
      return socket;
    },
  });
  return { api, socket, session: await promise };
}
describe('native Responses API', () => {
  it('keeps the wire client out of the factory API', () => {
    expect(ai({ name: 'openai', apiKey: 'test' })).not.toHaveProperty(
      'responses'
    );
  });
  it('preserves async and custom calls, delayed results, and configuration history', async () => {
    const requests: any[] = [];
    const api = client(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return Response.json(response(`r${requests.length}`));
    });
    await api.create({
      input: 'start',
      tools: [{ type: 'custom', name: 'lookup', async: true }],
    });
    await api.create({ previous_response_id: 'r1', input: 'independent work' });
    await api.create({
      previous_response_id: 'r2',
      input: [
        {
          type: 'custom_tool_call_output',
          call_id: 'call_original',
          output: 'result',
        },
        { type: 'configuration_update', reasoning: { effort: 'high' } },
        { type: 'message', role: 'user', content: 'continue' },
      ],
    });
    expect(requests[0].tools[0].async).toBe(true);
    expect(requests[2].input[0].call_id).toBe('call_original');
    expect(requests[2].input[1].reasoning.effort).toBe('high');
    expect(requests[2].reasoning.effort).toBe('low');
    expect(api.getUsage()).toHaveLength(3);
    expect(api.getEstimatedCost()).toBeCloseTo(0.0006);
  });
  it('validates before fetching and strips unsupported fields without mutating input', async () => {
    const fetch = vi.fn(async () => Response.json(response()));
    const api = client(fetch);
    await expect(
      api.create({ input: 'hi', reasoning: { effort: 'none' } })
    ).rejects.toThrow(/reasoning/);
    const update = {
      type: 'configuration_update',
      reasoning: { effort: 'high' },
    } as const;
    await expect(api.create({ input: [update, update] })).rejects.toThrow(
      /Adjacent/
    );
    await expect(
      api.create({ input: [update], truncation: 'auto' })
    ).rejects.toThrow(/truncation/);
    await expect(
      api.create({ model: 'gpt-5.6-sol', input: [update] })
    ).rejects.toThrow(/Astra/);
    expect(fetch).not.toHaveBeenCalled();
    const request = { input: 'hi', temperature: 1, top_p: 1, top_logprobs: 2 };
    await api.create(request);
    expect(request.temperature).toBe(1);
    const body = JSON.parse(String((fetch.mock.calls[0] as any)[1].body));
    expect(body.temperature).toBeUndefined();
    expect(body.top_logprobs).toBeUndefined();
  });
  it('refreshes authentication for each request', async () => {
    const headers: any[] = [];
    let n = 0;
    const api = new AxAIOpenAIResponsesClient({
      credentialProvider: async () => ({ Authorization: `Bearer ${++n}` }),
      defaults: { model },
      estimateCost: () => 0,
      options: () => ({
        fetch: async (_url, init) => {
          headers.push(init?.headers);
          return Response.json(response());
        },
      }),
    });
    await api.create({ input: 'one' });
    await api.create({ input: 'two' });
    expect(headers.map((h) => h.Authorization)).toEqual([
      'Bearer 1',
      'Bearer 2',
    ]);
  });
  it('streams partial arguments as deltas and completed calls exactly as sent', async () => {
    const events = [
      {
        type: 'response.function_call_arguments.delta',
        delta: '{',
        item_id: 'i',
      },
      {
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          call_id: 'c',
          name: 'lookup',
          arguments: '{}',
          async: true,
        },
      },
      { type: 'response.completed', response: response() },
      { type: 'response.completed', response: response() },
    ];
    const api = client(
      async () =>
        new Response(
          events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')
        )
    );
    const result = [];
    for await (const event of await api.create({ input: 'hi', stream: true }))
      result.push(event);
    expect(result).toEqual(events);
    expect(
      result.filter((e) => e.type === 'response.output_item.done')
    ).toHaveLength(1);
    expect(api.getUsage()).toHaveLength(1);
  });
  it('reports premature HTTP stream closure', async () => {
    const api = client(
      async () => new Response('data: {"type":"response.created"}\n\n')
    );
    const consume = async () => {
      for await (const _ of await api.create({ input: 'hi', stream: true })) {
      }
    };
    await expect(consume()).rejects.toThrow(/before completion/);
  });
  it('keeps reading through steering and accounts for both responses once', async () => {
    const { api, socket, session } = await connected();
    session.create({ input: 'start' });
    expect(() =>
      session.steer({ previous_response_id: 'unknown', input: 'change' })
    ).toThrow(/response.created/);
    socket.event({ type: 'response.created', response: response() });
    session.steer({ previous_response_id: 'r1', input: 'change' });
    session.steer({ previous_response_id: 'r1', input: 'another change' });
    socket.event({
      type: 'response.steer.accepted',
      steer: { id: 's1', previous_response_id: 'r1' },
    });
    socket.event({
      type: 'response.incomplete',
      response: { ...response(), incomplete_details: { reason: 'steered' } },
    });
    socket.event({ type: 'response.created', response: response('r2') });
    socket.event({ type: 'response.completed', response: response('r2') });
    socket.event({ type: 'response.completed', response: response('r2') });
    session.close();
    session.close();
    const events = [];
    for await (const event of session.events()) events.push(event);
    expect(events).toHaveLength(6);
    expect(socket.sent.map((e) => e.type)).toEqual([
      'response.create',
      'response.steer',
      'response.steer',
    ]);
    expect(api.getUsage()).toHaveLength(2);
    expect(socket.closes).toBe(1);
  });
  it('surfaces pending input and failures without repeating accepted steering', async () => {
    const { socket, session } = await connected();
    session.create({
      input: 'start',
      tools: [
        { type: 'function', name: 'lookup', parameters: {}, async: true },
      ],
    });
    socket.event({ type: 'response.created', response: response() });
    session.steer({ previous_response_id: 'r1', input: 'change' });
    socket.event({ type: 'response.completed', response: response() });
    socket.event({
      type: 'response.steer.pending',
      steer: { id: 's', previous_response_id: 'r1' },
      required_input: [{ type: 'function_call_output', call_id: 'c' }],
    });
    session.create({
      previous_response_id: 'r1',
      input: [{ type: 'function_call_output', call_id: 'c', output: 'done' }],
    });
    socket.event({
      type: 'response.steer.failed',
      steer: { id: 's', previous_response_id: 'r1', input: 'change' },
      error: { code: 'invalid_input', message: 'failed' },
    });
    session.close();
    const events = [];
    for await (const event of session.events()) events.push(event);
    expect(events.some((e) => e.type === 'response.steer.pending')).toBe(true);
    expect(events.some((e) => e.type === 'response.steer.failed')).toBe(true);
    expect(socket.sent.filter((e) => e.type === 'response.steer')).toHaveLength(
      1
    );
    expect(socket.sent[2].input[0].call_id).toBe('c');
  });
  it('aborts sessions and rejects further writes', async () => {
    const controller = new AbortController();
    const { session, socket } = await connected({
      abortSignal: controller.signal,
    });
    controller.abort();
    await expect(
      session.events()[Symbol.asyncIterator]().next()
    ).rejects.toThrow();
    expect(() => session.create({ input: 'hi' })).toThrow();
    expect(socket.closes).toBe(1);
  });
  it('validates updates across known history and preserves append-only input', async () => {
    const api = client(async () => Response.json(response()));
    const update = {
      type: 'configuration_update',
      reasoning: { effort: 'high' },
    } as const;
    await api.create({ input: [update] });
    await expect(
      api.create({ previous_response_id: 'r1', input: [update] })
    ).rejects.toThrow(/Adjacent/);
    await expect(
      api.create({
        previous_response_id: 'r1',
        input: 'next',
        truncation: 'auto',
      })
    ).rejects.toThrow(/truncation/);
  });
  it('times out opening a socket and removes its listeners', async () => {
    const socket = new Socket();
    await expect(
      client().connect({ webSocketFactory: () => socket, timeout: 5 })
    ).rejects.toThrow(/timed out/);
    expect(socket.closes).toBe(1);
    expect([...socket.listeners.values()].every((set) => set.size === 0)).toBe(
      true
    );
  });
  it('cancels the HTTP body when the event consumer stops', async () => {
    const cancel = vi.fn();
    const api = client(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"type":"response.created"}\n\n'
                )
              );
            },
            cancel,
          })
        )
    );
    for await (const _ of await api.create({ input: 'hi', stream: true }))
      break;
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('sends WebSocket native configuration updates and preserves request settings', async () => {
    const { session, socket } = await connected();
    session.create({
      input: [
        { type: 'configuration_update', reasoning: { effort: 'high' } },
        { type: 'message', role: 'user', content: 'next' },
      ],
      stream: true,
    });
    expect(socket.sent[0]).toMatchObject({
      type: 'response.create',
      reasoning: { effort: 'low' },
    });
    expect(socket.sent[0].stream).toBeUndefined();
    expect(socket.sent[0].input[0].reasoning.effort).toBe('high');
    session.close();
  });
  it('does not reconnect or replay on disconnect', async () => {
    const { session, socket } = await connected();
    session.create({ input: 'hi' });
    socket.emit('close');
    await expect(
      session.events()[Symbol.asyncIterator]().next()
    ).rejects.toThrow(/not replayed/);
    expect(socket.sent).toHaveLength(1);
  });
});
