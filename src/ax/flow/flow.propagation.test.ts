import { context, trace } from '@opentelemetry/api';
import { describe, expect, it, vi } from 'vitest';
import type { AxAIService } from '../ai/types.js';
import { AxSignature } from '../dsp/sig.js';
import type {
  AxProgramForwardOptions,
  AxProgrammable,
  AxProgramDemos,
} from '../dsp/types.js';
import { AxAIServiceAbortedError } from '../util/apicall.js';
import { flow } from './flow.js';

class TestProgram
  implements AxProgrammable<{ inputText: string }, { outputText: string }>
{
  private signature: AxSignature;
  public optimizedApplied = false;
  public seenTracer: unknown | undefined;
  public seenTraceContext: unknown | undefined;
  public seenAbortSignal: AbortSignal | undefined;

  constructor() {
    this.signature = new AxSignature('inputText:string -> outputText:string');
  }

  getSignature(): AxSignature {
    return this.signature;
  }

  // minimal surface needed by AxFlow.execute()
  async forward<T extends Readonly<AxAIService>>(
    _ai: T,
    values: { inputText: string },
    options?: Readonly<AxProgramForwardOptions<string>>
  ): Promise<{ outputText: string }> {
    this.seenTracer = (options as any)?.tracer;
    this.seenTraceContext = (options as any)?.traceContext;
    this.seenAbortSignal = options?.abortSignal;
    return { outputText: `seen:${values.inputText}` };
  }

  applyOptimization(): void {
    this.optimizedApplied = true;
  }

  // AxUsable / AxTunable minimal surface for registry compatibility
  setParentId(_parentId: string): void {}
  setId(_id: string): void {}
  setExamples(): void {}
  getTraces(): any[] {
    return [];
  }
  getUsage(): any[] {
    return [];
  }
  resetUsage(): void {}
}

describe('AxFlow propagation and instrumentation', () => {
  it('throws on setDemos when parent program has children but no matching parent demo', () => {
    const wf = flow<{ userInput: string }>();
    // add a simple node to ensure program has children
    wf.node('n1', 'documentText:string -> summaryText:string');
    // assign a known id so program is definitely considered a parent
    wf.setId('root');

    // No demos for parent id "root" provided → should throw
    const demos: AxProgramDemos<any, any>[] = [];
    expect(() => wf.setDemos(demos)).toThrowError();
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
      private signature = new AxSignature(
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
      setParentId(_parentId: string): void {}
      setId(_id: string): void {}
      setExamples(): void {}
      getTraces(): any[] {
        return [];
      }
      getUsage(): any[] {
        return [];
      }
      resetUsage(): void {}
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
