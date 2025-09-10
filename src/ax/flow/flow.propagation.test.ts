import { context, trace } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import type { AxAIService } from '../ai/types.js';
import { AxSignature } from '../dsp/sig.js';
import type {
  AxProgramForwardOptions,
  AxProgrammable,
  AxProgramDemos,
} from '../dsp/types.js';
import { flow } from './flow.js';

class TestProgram
  implements AxProgrammable<{ inputText: string }, { outputText: string }>
{
  private signature: AxSignature;
  public optimizedApplied = false;
  public seenTracer: unknown | undefined;
  public seenTraceContext: unknown | undefined;

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
});
