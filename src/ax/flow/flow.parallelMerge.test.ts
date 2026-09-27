/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';

import type { AxAIService } from '../ai/types.js';
import { AxSignature } from '../dsp/sig.js';

import { flow } from './flow.js';

// A node program that returns its scripted outputs in call order.
class QueueProgram {
  private id = 'root';
  private readonly signature: AxSignature;
  public calls = 0;

  constructor(
    signature: string,
    private readonly outputs: Record<string, unknown>[]
  ) {
    this.signature = AxSignature.create(signature);
  }

  getSignature() {
    return this.signature;
  }
  setId(id: string) {
    this.id = id;
  }
  getId() {
    return this.id;
  }
  namedPrograms() {
    return [{ id: this.id, signature: this.signature.toString() }];
  }
  namedProgramInstances() {
    return [];
  }
  async forward() {
    const output = this.outputs[Math.min(this.calls, this.outputs.length - 1)];
    this.calls++;
    return output;
  }
  setDemos() {}
  getDemos() {
    return [];
  }
  getUsage() {
    return [];
  }
  getTraces() {
    return [];
  }
  getChatLog() {
    return [];
  }
  resetUsage() {}
}

const ai = { name: 'mock' } as unknown as AxAIService;

const groups = (wf: { getExecutionPlan(): any }) =>
  wf
    .getExecutionPlan()
    .groups.map((group: any) =>
      group.steps.map((step: any) => step.nodeName ?? step.type)
    );

describe('AxFlow parallel group merge', () => {
  it('keeps an earlier step update to a key the state already held', async () => {
    const a = new QueueProgram('topic:string -> summary:string', [
      { summary: 'new' },
    ]);
    const b = new QueueProgram('topic:string -> title:string', [
      { title: 'title' },
    ]);
    const wf = flow<{ topic: string; aResult?: unknown }>()
      .node('a', a as any)
      .node('b', b as any)
      .execute('a', (state) => ({ topic: state.topic }))
      .execute('b', (state) => ({ topic: state.topic }));
    expect(groups(wf)).toEqual([['a', 'b']]);

    const out: any = await wf.forward(ai, {
      topic: 'x',
      aResult: { summary: 'old' },
    });

    expect(out.aResult).toEqual({ summary: 'new' });
    expect(out.bResult).toEqual({ title: 'title' });
  });

  it('keeps each loop iteration of a parallel body', async () => {
    const a = new QueueProgram('topic:string -> summary:string', [
      { summary: 's1' },
      { summary: 's2' },
    ]);
    const b = new QueueProgram('topic:string -> title:string', [
      { title: 't1' },
      { title: 't2' },
    ]);
    const wf = flow<{ topic: string; round: number }>()
      .node('a', a as any)
      .node('b', b as any)
      .while((state) => state.round < 2)
      .execute('a', (state) => ({ topic: state.topic }))
      .execute('b', (state) => ({ topic: state.topic }))
      .map((state) => ({ ...state, round: state.round + 1 }))
      .endWhile();

    const out: any = await wf.forward(ai, { topic: 'x', round: 0 });

    expect(out.round).toBe(2);
    expect(out.aResult).toEqual({ summary: 's2' });
    expect(out.bResult).toEqual({ title: 't2' });
  });

  it('keeps a node run a second time in a group', async () => {
    const a = new QueueProgram('topic:string -> summary:string', [
      { summary: 'first' },
      { summary: 'second' },
    ]);
    const b = new QueueProgram('topic:string -> title:string', [
      { title: 'title' },
    ]);
    const c = new QueueProgram('summary:string -> note:string', [
      { note: 'note' },
    ]);
    const wf = flow<{ topic: string }>()
      .node('a', a as any)
      .node('b', b as any)
      .node('c', c as any)
      .execute('a', (state) => ({ topic: state.topic }))
      .execute('c', (state: any) => ({ summary: state.aResult.summary }))
      .execute('a', (state) => ({ topic: state.topic }))
      .execute('b', (state) => ({ topic: state.topic }));
    expect(groups(wf)).toEqual([['a'], ['c'], ['a', 'b']]);

    const out: any = await wf.forward(ai, { topic: 'x' });

    expect(a.calls).toBe(2);
    expect(out.aResult).toEqual({ summary: 'second' });
  });

  it('keeps a derive step update in a loop group', async () => {
    const b = new QueueProgram('topic:string -> title:string', [
      { title: 't1' },
      { title: 't2' },
    ]);
    const wf = flow<{ topic: string; round: number }>()
      .node('b', b as any)
      .while((state) => state.round < 2)
      .derive('label', 'round', (value: number) => `round ${value}`)
      .execute('b', (state) => ({ topic: state.topic }))
      .map((state) => ({ ...state, round: state.round + 1 }))
      .endWhile();

    const out: any = await wf.forward(ai, { topic: 'x', round: 0 });

    expect(out.round).toBe(2);
    expect(out.label).toBe('round 1');
    expect(out.bResult).toEqual({ title: 't2' });
  });

  it('matches running the steps one after another', async () => {
    const run = async (autoParallel: boolean) => {
      const a = new QueueProgram('topic:string -> summary:string', [
        { summary: 's1' },
        { summary: 's2' },
      ]);
      const b = new QueueProgram('topic:string -> title:string', [
        { title: 't1' },
        { title: 't2' },
      ]);
      const wf = flow<{ topic: string; round: number }>({ autoParallel })
        .node('a', a as any)
        .node('b', b as any)
        .while((state) => state.round < 2)
        .execute('a', (state) => ({ topic: state.topic }))
        .execute('b', (state) => ({ topic: state.topic }))
        .map((state) => ({ ...state, round: state.round + 1 }))
        .endWhile();
      return wf.forward(ai, { topic: 'x', round: 0 });
    };

    expect(await run(true)).toEqual(await run(false));
  });
});
