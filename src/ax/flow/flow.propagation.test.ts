import type { Context, Span, Tracer } from '@opentelemetry/api';
import { context, trace } from '@opentelemetry/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AxMockAIService } from '../ai/mock/api.js';
import type { AxAIService } from '../ai/types.js';
import { axGlobals } from '../dsp/globals.js';
import { AxSignature } from '../dsp/sig.js';
import { ax } from '../dsp/template.js';
import type {
  AxChatLogEntry,
  AxProgramDemos,
  AxProgramForwardOptions,
  AxProgrammable,
  AxProgramTrace,
  AxProgramUsage,
} from '../dsp/types.js';
import { AxMCPClient } from '../mcp/client.js';
import type { AxMCPExecutionContext } from '../mcp/execution.js';
import type { AxMCPTransport } from '../mcp/transport.js';
import { AxAIServiceAbortedError } from '../util/apicall.js';
import { axGetRuntimeHookFrame } from '../util/telemetry.js';
import { flow } from './flow.js';

class TestProgram
  implements AxProgrammable<{ inputText: string }, { outputText: string }>
{
  private signature: AxSignature;
  public optimizedApplied = false;
  public seenAI: AxAIService | undefined;
  public seenRateLimiter: unknown | undefined;
  public seenTracer: unknown | undefined;
  public seenTraceContext: unknown | undefined;
  public seenAbortSignal: AbortSignal | undefined;
  public seenMCPExecutionContext: AxMCPExecutionContext | undefined;
  public seenEventContext: unknown | undefined;
  public defaultRateLimiter: unknown | undefined;
  public allSeenRateLimiters: unknown[] = [];
  public usage: AxProgramUsage[] = [];
  public traces: AxProgramTrace<any, any>[] = [];
  public chatLog: AxChatLogEntry[] = [];

  constructor() {
    this.signature = AxSignature.from('inputText:string -> outputText:string');
  }

  getSignature(): AxSignature {
    return this.signature;
  }

  // minimal surface needed by AxFlow.execute()
  async forward<T extends Readonly<AxAIService>>(
    ai: T,
    values: { inputText: string },
    options?: Readonly<AxProgramForwardOptions<string>>
  ): Promise<{ outputText: string }> {
    this.seenAI = ai as AxAIService;
    this.seenRateLimiter =
      options?.rateLimiter ??
      this.defaultRateLimiter ??
      axGetRuntimeHookFrame(options)?.globals.rateLimiter;
    this.allSeenRateLimiters.push(this.seenRateLimiter);
    this.seenTracer =
      (options as any)?.tracer ??
      axGetRuntimeHookFrame(options)?.globals.tracer;
    this.seenTraceContext = (options as any)?.traceContext;
    this.seenAbortSignal = options?.abortSignal;
    this.seenMCPExecutionContext = options?._mcpExecutionContext;
    this.seenEventContext = options?.eventContext;
    return { outputText: `seen:${values.inputText}` };
  }

  applyOptimization(): void {
    this.optimizedApplied = true;
  }

  // AxUsable / AxTunable minimal surface for registry compatibility
  private _id = '';
  getId(): string {
    return this._id;
  }
  setId(id: string): void {
    this._id = id;
  }
  setDemos(): void {}
  getTraces(): AxProgramTrace<any, any>[] {
    return this.traces;
  }
  getUsage(): AxProgramUsage[] {
    return this.usage;
  }
  resetUsage(): void {}
  getChatLog(): readonly AxChatLogEntry[] {
    return this.chatLog;
  }
  getOptimizableComponents(): readonly any[] {
    return [];
  }
  applyOptimizedComponents(): void {}
}

describe('AxFlow propagation and instrumentation', () => {
  const originalTracer = axGlobals.tracer;
  const originalRateLimiter = axGlobals.rateLimiter;

  afterEach(() => {
    axGlobals.tracer = originalTracer;
    axGlobals.rateLimiter = originalRateLimiter;
  });

  it('setDemos propagates to children with name-based IDs', () => {
    const wf = flow<{ userInput: string }>();
    wf.node('n1', 'documentText:string -> summaryText:string');
    wf.setId('root');

    // Demos targeting child node by name-based ID should not throw
    const demos: AxProgramDemos<any, any>[] = [
      {
        programId: 'root.n1',
        traces: [{ documentText: 'input text', summaryText: 'test' }],
      },
    ];
    expect(() => wf.setDemos(demos)).not.toThrowError();
  });

  it('allows empty demos array (clears demos or propagates options)', () => {
    const wf = flow<{ userInput: string }>();
    wf.node('n1', 'documentText:string -> summaryText:string');
    wf.setId('root');

    // Empty demos should not throw
    const demos: AxProgramDemos<any, any>[] = [];
    expect(() => wf.setDemos(demos)).not.toThrowError();
  });

  it('throws on unknown programId in setDemos', () => {
    const wf = flow<{ userInput: string }>();
    wf.node('n1', 'documentText:string -> summaryText:string');
    wf.setId('root');

    const demos: AxProgramDemos<any, any>[] = [
      { programId: 'root.typo', traces: [{ summaryText: 'test' }] },
    ];
    expect(() => wf.setDemos(demos)).toThrowError(/Unknown program ID/);
  });

  it('applyOptimization propagates to node programs', () => {
    const prog = new TestProgram();
    const wf = flow<{ userInput: string }>();
    wf.node('p', prog);
    // dummy optimized program
    const opt = { applyTo: () => {} } as any;
    wf.applyOptimization(opt);
    expect(prog.optimizedApplied).toBe(true);
  });

  it('exposes live program instances for registered nodes', () => {
    const classifier = ax('inputText:string -> outputText:string');
    const wf = flow<{ inputText: string }>();
    wf.node('classifier', classifier);
    wf.setId('root');

    const instances = wf.namedProgramInstances();
    expect(instances.map((instance) => instance.id)).toContain(
      'root.classifier'
    );
    expect(
      instances.find((instance) => instance.id === 'root.classifier')?.program
    ).toBe(classifier);
  });

  it('applyOptimization uses componentMap for registered nodes', () => {
    const classifier = ax('inputText:string -> outputText:string');
    const rationale = ax('inputText:string -> outputText:string');
    classifier.setInstruction('before-classifier');
    rationale.setInstruction('before-rationale');

    const wf = flow<{ inputText: string }>();
    wf.node('classifier', classifier);
    wf.node('rationale', rationale);
    wf.setId('root');

    wf.applyOptimization({
      bestScore: 1,
      stats: {} as any,
      componentMap: {
        'root.classifier::instruction': 'after-classifier',
        'root.rationale::instruction': 'after-rationale',
      },
      optimizerType: 'GEPA',
      optimizationTime: 0,
      totalRounds: 0,
      converged: true,
      applyTo: () => {},
    } as any);

    expect(classifier.getInstruction()).toBe('after-classifier');
    expect(rationale.getInstruction()).toBe('after-rationale');
  });

  it('propagates tracer and parent traceContext to node forwards', async () => {
    const tracer = trace.getTracer('axflow-test');
    const wf = flow<
      { userInput: string },
      { pResult: { outputText: string } }
    >();
    const prog = new TestProgram();
    wf.node('p', prog).execute('p', (s) => ({ inputText: s.userInput }));

    // Use a mock AI service object; only identity is required for our program
    const ai = { name: 'mock' } as unknown as AxAIService;

    const parentCtx = context.active();
    await wf.forward(
      ai,
      { userInput: 'hi' },
      { tracer, traceContext: parentCtx }
    );

    expect(prog.seenTracer).toBeDefined();
    expect(prog.seenTraceContext).toBeDefined();
  });

  it('parents AxGen node spans under the enclosing flow span', async () => {
    const starts: Array<{
      name: string;
      parentContext?: Context;
      span: Span;
    }> = [];
    const makeSpan = (): Span =>
      ({
        addEvent: vi.fn(),
        addLink: vi.fn(),
        addLinks: vi.fn(),
        end: vi.fn(),
        isRecording: () => true,
        recordException: vi.fn(),
        setAttribute: vi.fn(),
        setAttributes: vi.fn(),
        setStatus: vi.fn(),
        spanContext: () => ({
          traceId: '1'.repeat(32),
          spanId: '2'.repeat(16),
          traceFlags: 1,
        }),
        updateName: vi.fn(),
      }) as unknown as Span;
    const tracer = {
      startSpan: (name: string, _options: unknown, parentContext?: Context) => {
        const span = makeSpan();
        starts.push({ name, parentContext, span });
        return span;
      },
    } as unknown as Tracer;
    const ai = new AxMockAIService({
      chatResponse: {
        results: [
          {
            index: 0,
            content: '{"outputText":"ok"}',
            finishReason: 'stop',
          },
        ],
      },
    });
    const wf = flow<{ inputText: string }>();
    wf.node('generate', 'inputText:string -> outputText:string').execute(
      'generate',
      (state) => ({ inputText: state.inputText })
    );

    const upstreamSpan = makeSpan();
    const upstreamContext = trace.setSpan(context.active(), upstreamSpan);
    await wf.forward(
      ai,
      { inputText: 'parentage' },
      { tracer, traceContext: upstreamContext }
    );

    const flowStart = starts.find((start) => start.name === 'AxFlow');
    const genStart = starts.find((start) => start.name.startsWith('AxGen'));
    expect(flowStart).toBeDefined();
    expect(genStart).toBeDefined();
    expect(
      trace.getSpan(flowStart?.parentContext as Context)?.spanContext()
    ).toEqual(upstreamSpan.spanContext());
    expect(
      trace.getSpan(genStart?.parentContext as Context)?.spanContext()
    ).toEqual(flowStart?.span.spanContext());
  });

  it('propagates forward and constructor rate limiters to every node', async () => {
    const defaultLimiter = vi.fn(async (next: () => Promise<unknown>) =>
      next()
    );
    const overrideLimiter = vi.fn(async (next: () => Promise<unknown>) =>
      next()
    );
    const first = new TestProgram();
    const second = new TestProgram();
    const wf = flow<{ userInput: string }>({ rateLimiter: defaultLimiter });
    wf.node('first', first)
      .node('second', second)
      .execute('first', (state) => ({ inputText: state.userInput }))
      .execute('second', (state) => ({ inputText: state.userInput }));
    const ai = { name: 'mock' } as unknown as AxAIService;

    await wf.forward(ai, { userInput: 'default' });
    expect(first.seenRateLimiter).toBe(defaultLimiter);
    expect(second.seenRateLimiter).toBe(defaultLimiter);

    await wf.forward(
      ai,
      { userInput: 'override' },
      { rateLimiter: overrideLimiter }
    );
    expect(first.seenRateLimiter).toBe(overrideLimiter);
    expect(second.seenRateLimiter).toBe(overrideLimiter);
  });

  it('snapshots a live global rate limiter for the whole flow run', async () => {
    const globalLimiter = vi.fn(async (next: () => Promise<unknown>) => next());
    const replacement = vi.fn(async (next: () => Promise<unknown>) => next());
    const first = new TestProgram();
    const second = new TestProgram();
    const firstForward = first.forward.bind(first);
    first.forward = async (...args: Parameters<typeof first.forward>) => {
      const result = await firstForward(...args);
      axGlobals.rateLimiter = replacement;
      return result;
    };
    const wf = flow<{ userInput: string }>();
    wf.node('first', first)
      .node('second', second)
      .execute('first', (state) => ({ inputText: state.userInput }))
      .execute('second', (state) => ({ inputText: state.userInput }));
    const ai = { name: 'mock' } as unknown as AxAIService;
    axGlobals.rateLimiter = globalLimiter;

    await wf.forward(ai, { userInput: 'snapshot' });
    expect(first.seenRateLimiter).toBe(globalLimiter);
    expect(second.seenRateLimiter).toBe(globalLimiter);
  });

  it('keeps an empty global snapshot empty when the global is replaced mid-run', async () => {
    const replacement = vi.fn(async (next: () => Promise<unknown>) => next());
    const first = new TestProgram();
    const second = new TestProgram();
    const firstForward = first.forward.bind(first);
    first.forward = async (...args: Parameters<typeof first.forward>) => {
      const result = await firstForward(...args);
      axGlobals.rateLimiter = replacement;
      return result;
    };
    const wf = flow<{ userInput: string }>();
    wf.node('first', first)
      .node('second', second)
      .execute('first', (state) => ({ inputText: state.userInput }))
      .execute('second', (state) => ({ inputText: state.userInput }));
    const ai = { name: 'mock' } as unknown as AxAIService;
    axGlobals.rateLimiter = undefined;

    await wf.forward(ai, { userInput: 'empty-snapshot' });
    expect(first.seenRateLimiter).toBeUndefined();
    expect(second.seenRateLimiter).toBeUndefined();
  });

  it('keeps child defaults above the snapshotted global hook', async () => {
    const globalLimiter = vi.fn(async (next: () => Promise<unknown>) => next());
    const childLimiter = vi.fn(async (next: () => Promise<unknown>) => next());
    const parentLimiter = vi.fn(async (next: () => Promise<unknown>) => next());
    const child = new TestProgram();
    child.defaultRateLimiter = childLimiter;
    const ai = { name: 'mock' } as unknown as AxAIService;
    axGlobals.rateLimiter = globalLimiter;

    await flow<{ userInput: string }>()
      .node('child', child)
      .execute('child', (state) => ({ inputText: state.userInput }))
      .forward(ai, { userInput: 'child-default' });
    expect(child.seenRateLimiter).toBe(childLimiter);

    await flow<{ userInput: string }>({ rateLimiter: parentLimiter })
      .node('child', child)
      .execute('child', (state) => ({ inputText: state.userInput }))
      .forward(ai, { userInput: 'parent-default' });
    expect(child.seenRateLimiter).toBe(parentLimiter);
  });

  it('isolates concurrent and re-entrant forward hooks', async () => {
    const firstLimiter = vi.fn(async (next: () => Promise<unknown>) => next());
    const secondLimiter = vi.fn(async (next: () => Promise<unknown>) => next());
    const child = new TestProgram();
    const wf = flow<{ userInput: string }>();
    wf.node('child', child).execute('child', (state) => ({
      inputText: state.userInput,
    }));
    const ai = { name: 'mock' } as unknown as AxAIService;

    await Promise.all([
      wf.forward(ai, { userInput: 'one' }, { rateLimiter: firstLimiter }),
      wf.forward(ai, { userInput: 'two' }, { rateLimiter: secondLimiter }),
    ]);
    expect(new Set(child.allSeenRateLimiters)).toEqual(
      new Set([firstLimiter, secondLimiter])
    );

    child.allSeenRateLimiters.length = 0;
    let reentered = false;
    const baseForward = child.forward.bind(child);
    child.forward = async (...args: Parameters<typeof child.forward>) => {
      const result = await baseForward(...args);
      if (!reentered) {
        reentered = true;
        await wf.forward(
          ai,
          { userInput: 'inner' },
          { rateLimiter: secondLimiter }
        );
      }
      return result;
    };
    await wf.forward(ai, { userInput: 'outer' }, { rateLimiter: firstLimiter });
    expect(child.allSeenRateLimiters).toEqual([firstLimiter, secondLimiter]);

    child.allSeenRateLimiters.length = 0;
    await wf.forward(ai, { userInput: 'after' });
    expect(child.allSeenRateLimiters).toEqual([undefined]);
  });

  it('uses axGlobals.tracer set after construction for parent and node tracing', async () => {
    const spanEnd = vi.fn();
    const tracer = {
      startSpan: vi.fn(() => ({ end: spanEnd })),
    } as any;
    const wf = flow<
      { userInput: string },
      { pResult: { outputText: string } }
    >();
    const prog = new TestProgram();
    wf.node('p', prog).execute('p', (s) => ({ inputText: s.userInput }));
    const ai = { name: 'mock' } as unknown as AxAIService;

    axGlobals.tracer = tracer;

    await wf.forward(ai, { userInput: 'hi' });

    expect(tracer.startSpan).toHaveBeenCalledWith(
      'AxFlow',
      expect.objectContaining({ kind: expect.any(Number) }),
      expect.anything()
    );
    expect(prog.seenTracer).toBe(tracer);
    expect(prog.seenTraceContext).toBeDefined();
    expect(spanEnd).toHaveBeenCalledTimes(1);
  });

  it('propagates event context to nodes unless inheritance is none', async () => {
    const eventContext = { runId: 'event-run' } as any;
    const inherited = new TestProgram();
    const inheritedFlow = flow<{ userInput: string }>();
    inheritedFlow
      .node('p', inherited)
      .execute('p', (state) => ({ inputText: state.userInput }));
    const ai = { name: 'mock' } as unknown as AxAIService;
    await inheritedFlow.forward(ai, { userInput: 'hi' }, { eventContext });
    expect(inherited.seenEventContext).toBe(eventContext);

    const blocked = new TestProgram();
    const blockedFlow = flow<{ userInput: string }>();
    blockedFlow
      .node('p', blocked)
      .execute('p', (state) => ({ inputText: state.userInput }));
    await blockedFlow.forward(
      ai,
      { userInput: 'hi' },
      { eventContext, eventInheritance: 'none' }
    );
    expect(blocked.seenEventContext).toBeUndefined();
  });

  it('shares native MCP context with nodes and enforces flow inheritance', async () => {
    const transport: AxMCPTransport = {
      send: async (request) => ({
        jsonrpc: '2.0',
        id: request.id,
        result:
          request.method === 'initialize'
            ? {
                protocolVersion: '2025-11-25',
                capabilities: { tools: {} },
                serverInfo: { name: 'inventory', version: '1.0.0' },
              }
            : { tools: [] },
      }),
      sendNotification: async () => {},
    };
    const client = new AxMCPClient(transport, { namespace: 'inventory' });
    const inherited = new TestProgram();
    const isolated = new TestProgram();
    const ai = { name: 'mock' } as unknown as AxAIService;

    await flow<{ userInput: string }>()
      .node('p', inherited)
      .execute('p', (s) => ({ inputText: s.userInput }))
      .forward(ai, { userInput: 'hi' }, { mcp: client });
    await flow<{ userInput: string }>()
      .node('p', isolated)
      .execute('p', (s) => ({ inputText: s.userInput }))
      .forward(
        ai,
        { userInput: 'hi' },
        { mcp: client, mcpInheritance: 'none' }
      );

    expect(inherited.seenMCPExecutionContext?.getClient('inventory')).toBe(
      client
    );
    expect(isolated.seenMCPExecutionContext).toBeUndefined();
  });

  it('parallel map merges outputs from all transforms', async () => {
    const wf = flow<{ a: number }>().map(
      [(s) => ({ ...s, x: s.a + 1 }), (s) => ({ ...s, y: s.a + 2 })],
      { parallel: true }
    );

    const ai = { name: 'mock' } as unknown as AxAIService;
    const out = await wf.forward(ai, { a: 1 });
    expect((out as any).x).toBe(2);
    expect((out as any).y).toBe(3);
  });

  it('explicit parallel subflows preserve telemetry and dynamic AI/options', async () => {
    const left = new TestProgram();
    const right = new TestProgram();
    left.usage = [
      {
        ai: 'left-ai',
        model: 'left-model',
        tokens: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      } as AxProgramUsage,
    ];
    right.usage = [
      {
        ai: 'right-ai',
        model: 'right-model',
        tokens: { promptTokens: 2, completionTokens: 3, totalTokens: 5 },
      } as AxProgramUsage,
    ];
    left.traces = [{ programId: 'left-trace', trace: { outputText: 'left' } }];
    right.traces = [
      { programId: 'right-trace', trace: { outputText: 'right' } },
    ];
    left.chatLog = [
      {
        name: 'round',
        model: 'left-model',
        messages: [{ role: 'user', content: 'left' }],
      },
    ];
    right.chatLog = [
      {
        name: 'round',
        model: 'right-model',
        messages: [{ role: 'user', content: 'right' }],
      },
    ];

    const tracer = trace.getTracer('axflow-parallel-test');
    const mainAI = { name: 'main' } as unknown as AxAIService;
    const overrideAI = { name: 'override' } as unknown as AxAIService;

    const wf = flow<{ userInput: string }>()
      .node('left', left)
      .node('right', right)
      .parallel([
        (sub) =>
          sub.execute('left', (s) => ({ inputText: s.userInput }), {
            ai: overrideAI,
          } as any),
        (sub) => sub.execute('right', (s) => ({ inputText: s.userInput })),
      ])
      .merge('combined', (leftResult, rightResult) => {
        const l = leftResult as { leftResult: { outputText: string } };
        const r = rightResult as { rightResult: { outputText: string } };
        return `${l.leftResult.outputText}:${r.rightResult.outputText}`;
      })
      .returns((s) => ({ combined: s.combined }));

    const result = await wf.forward(mainAI, { userInput: 'hello' }, { tracer });

    expect(result.combined).toBe('seen:hello:seen:hello');
    expect(left.seenAI).toBe(overrideAI);
    expect(right.seenAI).toBe(mainAI);
    expect(left.seenTracer).toBe(tracer);
    expect(right.seenTracer).toBe(tracer);
    expect(wf.getUsage().map((usage) => usage.ai)).toEqual(
      expect.arrayContaining(['left-ai', 'right-ai'])
    );
    expect(wf.getTraces().map((entry) => entry.programId)).toEqual(
      expect.arrayContaining(['left-trace', 'right-trace'])
    );
    expect(wf.getChatLog().map((entry) => entry.name)).toEqual(
      expect.arrayContaining(['left.round', 'right.round'])
    );
  });

  it('ends parent tracing span when flow throws', async () => {
    const spanEnd = vi.fn();
    const tracer = {
      startSpan: () => ({ end: spanEnd }),
    } as any;

    const wf = flow<{ n: number }>()
      .map((s) => ({ ...s, n: s.n + 1 }))
      .map(() => {
        throw new Error('boom');
      });

    const ai = { name: 'mock' } as unknown as AxAIService;
    await expect(wf.forward(ai, { n: 1 }, { tracer })).rejects.toThrowError(
      'boom'
    );
    expect(spanEnd).toHaveBeenCalledTimes(1);
  });

  it('threads abortController and aborts between steps', async () => {
    const controller = new AbortController();
    const wf = flow<{ value: number }>({ autoParallel: false })
      .map((s) => ({ ...s, value: s.value + 1 }))
      .map((s) => {
        controller.abort('user-cancelled');
        return s;
      })
      .map((s) => ({ ...s, value: s.value + 1 }));

    const ai = { name: 'mock' } as unknown as AxAIService;
    await expect(
      wf.forward(ai, { value: 1 }, { abortController: controller } as any)
    ).rejects.toBeInstanceOf(AxAIServiceAbortedError);
  });

  it('stop() aborts an in-flight node execution', async () => {
    class AbortAwareProgram
      implements AxProgrammable<{ inputText: string }, { outputText: string }>
    {
      private signature = AxSignature.from(
        'inputText:string -> outputText:string'
      );
      getSignature(): AxSignature {
        return this.signature;
      }
      async forward<T extends Readonly<AxAIService>>(
        _ai: T,
        values: { inputText: string },
        options?: Readonly<AxProgramForwardOptions<string>>
      ): Promise<{ outputText: string }> {
        const signal = options?.abortSignal;
        if (!signal) return { outputText: values.inputText };
        if (signal.aborted) {
          throw new AxAIServiceAbortedError(
            'flow-stop-test',
            signal.reason ?? 'aborted'
          );
        }
        await new Promise<void>((resolve, reject) => {
          const onAbort = () =>
            reject(
              new AxAIServiceAbortedError(
                'flow-stop-test',
                signal.reason ?? 'aborted'
              )
            );
          signal.addEventListener('abort', onAbort, { once: true });
          setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
          }, 300);
        });
        return { outputText: values.inputText };
      }
      private _id = '';
      getId(): string {
        return this._id;
      }
      setId(id: string): void {
        this._id = id;
      }
      setDemos(): void {}
      getTraces(): any[] {
        return [];
      }
      getUsage(): any[] {
        return [];
      }
      resetUsage(): void {}
      getOptimizableComponents(): readonly any[] {
        return [];
      }
      applyOptimizedComponents(): void {}
    }

    const wf = flow<{ userInput: string }>()
      .node('abortAware', new AbortAwareProgram())
      .execute('abortAware', (s) => ({ inputText: s.userInput }));
    const ai = { name: 'mock' } as unknown as AxAIService;

    const p = wf.forward(ai, { userInput: 'hello' });
    setTimeout(() => wf.stop(), 20);

    await expect(p).rejects.toBeInstanceOf(AxAIServiceAbortedError);
  });
});
