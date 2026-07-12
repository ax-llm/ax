import { context, trace } from '@opentelemetry/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
import { flow } from './flow.js';

class TestProgram
  implements AxProgrammable<{ inputText: string }, { outputText: string }>
{
  private signature: AxSignature;
  public optimizedApplied = false;
  public seenAI: AxAIService | undefined;
  public seenTracer: unknown | undefined;
  public seenTraceContext: unknown | undefined;
  public seenAbortSignal: AbortSignal | undefined;
  public seenMCPExecutionContext: AxMCPExecutionContext | undefined;
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
    this.seenTracer = (options as any)?.tracer;
    this.seenTraceContext = (options as any)?.traceContext;
    this.seenAbortSignal = options?.abortSignal;
    this.seenMCPExecutionContext = options?._mcpExecutionContext;
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

  afterEach(() => {
    axGlobals.tracer = originalTracer;
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
      expect.objectContaining({ kind: expect.any(Number) })
    );
    expect(prog.seenTracer).toBe(tracer);
    expect(prog.seenTraceContext).toBeDefined();
    expect(spanEnd).toHaveBeenCalledTimes(1);
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
