import { describe, expect, it, vi } from 'vitest';
import { AxMockAIService } from '../ai/mock/api.js';
import type { AxFunction } from '../ai/types.js';
import { AxGen } from './generate.js';
import type { AxFunctionCallTrace } from './types.js';

describe('AxGen onFunctionCall hook', () => {
  it('fires for successful function calls without breaking generation', async () => {
    const traces: AxFunctionCallTrace[] = [];
    const fn: AxFunction = {
      name: 'lookup_user',
      description: 'Lookup a user',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      func: async ({ id }: any) => ({ name: `user-${id}` }),
    };

    let callCount = 0;
    const ai = new AxMockAIService({
      features: { functions: true, streaming: false },
      chatResponse: async () => {
        callCount++;
        if (callCount === 1) {
          return {
            results: [
              {
                index: 0,
                content: '',
                finishReason: 'stop' as const,
                functionCalls: [
                  {
                    id: 'call_1',
                    type: 'function' as const,
                    function: {
                      name: 'lookup_user',
                      params: { id: '42' },
                    },
                  },
                ],
              },
            ],
          };
        }
        return {
          results: [
            {
              index: 0,
              content: 'answer: done',
              finishReason: 'stop' as const,
            },
          ],
        };
      },
    });

    const gen = new AxGen<{ query: string }, { answer: string }>(
      'query:string -> answer:string',
      { functions: [fn] }
    );

    await gen.forward(
      ai,
      { query: 'q' },
      { onFunctionCall: (call) => traces.push({ ...call }) }
    );

    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      fn: 'lookup_user',
      componentId: 'lookup_user',
      args: { id: '42' },
      ok: true,
    });
    expect(traces[0]?.ms).toBeGreaterThanOrEqual(0);
  });

  it('swallows hook errors', async () => {
    const fn: AxFunction = {
      name: 'lookup_user',
      description: 'Lookup a user',
      parameters: { type: 'object', properties: {} },
      func: async () => 'ok',
    };

    let callCount = 0;
    const ai = new AxMockAIService({
      features: { functions: true, streaming: false },
      chatResponse: async () => {
        callCount++;
        if (callCount === 1) {
          return {
            results: [
              {
                index: 0,
                content: '',
                finishReason: 'stop' as const,
                functionCalls: [
                  {
                    id: 'call_1',
                    type: 'function' as const,
                    function: { name: 'lookup_user', params: {} },
                  },
                ],
              },
            ],
          };
        }
        return {
          results: [
            {
              index: 0,
              content: 'answer: done',
              finishReason: 'stop' as const,
            },
          ],
        };
      },
    });

    const gen = new AxGen<{ query: string }, { answer: string }>(
      'query:string -> answer:string',
      { functions: [fn] }
    );

    await expect(
      gen.forward(
        ai,
        { query: 'q' },
        {
          onFunctionCall: () => {
            throw new Error('hook failed');
          },
        }
      )
    ).resolves.toMatchObject({ answer: 'answer: done' });
  });

  it('keeps provider ids in chat logs', async () => {
    const ai = new AxMockAIService({
      features: { functions: true, streaming: false },
      chatResponse: async () => ({
        sessionId: 'session-123',
        remoteId: 'resp-123',
        remoteRequestId: 'req-123',
        results: [
          {
            index: 0,
            content: 'answer: done',
            finishReason: 'stop' as const,
          },
        ],
      }),
    });
    const gen = new AxGen<{ query: string }, { answer: string }>(
      'query:string -> answer:string'
    );

    await gen.forward(ai, { query: 'q' }, { sessionId: 'session-123' });

    expect(gen.getChatLog()[0]).toMatchObject({
      sessionId: 'session-123',
      remoteId: 'resp-123',
      remoteRequestId: 'req-123',
    });
  });

  it('starts tool spans with the AxGen trace context', async () => {
    let functionTraceId: string | undefined;
    const fn: AxFunction = {
      name: 'lookup_user',
      description: 'Lookup a user',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      func: async ({ id }: any, extra?: Readonly<{ traceId?: string }>) => {
        functionTraceId = extra?.traceId;
        return { name: `user-${id}` };
      },
    };

    let callCount = 0;
    const ai = new AxMockAIService({
      features: { functions: true, streaming: false },
      chatResponse: async () => {
        callCount++;
        if (callCount === 1) {
          return {
            results: [
              {
                index: 0,
                content: '',
                finishReason: 'stop' as const,
                functionCalls: [
                  {
                    id: 'call_1',
                    type: 'function' as const,
                    function: {
                      name: 'lookup_user',
                      params: { id: '42' },
                    },
                  },
                ],
              },
            ],
          };
        }
        return {
          results: [
            {
              index: 0,
              content: 'answer: done',
              finishReason: 'stop' as const,
            },
          ],
        };
      },
    });

    const parentSpan = {
      spanContext: () => ({
        traceId: 'trace-parent',
        spanId: 'span-parent',
        traceFlags: 1,
      }),
      addEvent: vi.fn(),
      recordException: vi.fn(),
      setStatus: vi.fn(),
      end: vi.fn(),
    };
    const toolSpan = {
      spanContext: () => ({
        traceId: 'trace-parent',
        spanId: 'span-tool',
        traceFlags: 1,
      }),
      setAttributes: vi.fn(),
      addEvent: vi.fn(),
      recordException: vi.fn(),
      end: vi.fn(),
    };
    let toolParentContext: unknown;
    const tracer = {
      startSpan: vi.fn(() => parentSpan),
      startActiveSpan: vi.fn(
        (
          _name: string,
          optionsOrCallback: unknown,
          contextOrCallback?: unknown,
          maybeCallback?: unknown
        ) => {
          const callback =
            typeof optionsOrCallback === 'function'
              ? optionsOrCallback
              : typeof contextOrCallback === 'function'
                ? contextOrCallback
                : maybeCallback;
          toolParentContext =
            typeof contextOrCallback === 'function'
              ? undefined
              : contextOrCallback;
          return (callback as (span: typeof toolSpan) => unknown)(toolSpan);
        }
      ),
    };

    const gen = new AxGen<{ query: string }, { answer: string }>(
      'query:string -> answer:string',
      { functions: [fn] }
    );

    await gen.forward(ai, { query: 'q' }, { tracer: tracer as any });

    expect(tracer.startSpan).toHaveBeenCalledWith(
      'AxGen',
      expect.objectContaining({ kind: 1 })
    );
    expect(tracer.startActiveSpan).toHaveBeenCalledWith(
      'Tool: lookup_user',
      {},
      expect.anything(),
      expect.any(Function)
    );
    expect(toolParentContext).toBeDefined();
    expect(functionTraceId).toBe('trace-parent');
  });
});
