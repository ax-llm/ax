// Compile-time tests for AxFlow typing, enforced by `npm run test:type-tests`
// (tsc -p tsconfig.typetests.json).
import type { Equal, Expect } from '../util/typetest.js';
import { flow } from './flow.js';

// setDemos — type-safe programId when nodes are chained
{
  const wf = flow<{ input: string }>()
    .node('summarizer', 'text:string -> summary:string')
    .node('classifier', 'text:string -> category:string');

  // Valid: known node names
  wf.setDemos([{ programId: 'root.summarizer', traces: [] }]);
  wf.setDemos([{ programId: 'root.classifier', traces: [] }]);
  wf.setDemos([{ programId: 'custom.summarizer', traces: [] }]);

  // @ts-expect-error typo in node name
  wf.setDemos([{ programId: 'root.summerizer', traces: [] }]);
  // @ts-expect-error unknown node name
  wf.setDemos([{ programId: 'root.parser', traces: [] }]);
}

// setDemos — falls back to string when no nodes are chained
{
  const wf = flow<{ input: string }>();

  // No constraint when TNodes is empty — any string programId is accepted
  wf.setDemos([{ programId: 'root.anything', traces: [] }]);
  wf.setDemos([{ programId: 'whatever', traces: [] }]);
}

// state evolves after execute and returns controls final output
{
  const wf = flow<{ input: string }>()
    .node('summarizer', 'text:string -> summary:string')
    .execute('summarizer', (state) => ({ text: state.input }))
    .returns((state) => ({ final: state.summarizerResult.summary }));

  const result = wf.forward({} as any, { input: 'hello' });
  type _result = Expect<Equal<typeof result, Promise<{ final: string }>>>;
}

// unknown node names are rejected
{
  const wf = flow<{ input: string }>().node(
    'known',
    'text:string -> summary:string'
  );

  // @ts-expect-error unknown node name is rejected by execute()
  wf.execute('missing', (state) => ({ text: state.input }));
}

// explicit parallel merge result is preserved in the state type
{
  const wf = flow<{ input: string }>()
    .node('left', 'text:string -> out:string')
    .node('right', 'text:string -> out:string')
    .parallel([
      (sub) => sub.execute('left', (state) => ({ text: state.input })),
      (sub) => sub.execute('right', (state) => ({ text: state.input })),
    ])
    .merge('combined', (left, right) => {
      const l = left as { leftResult: { out: string } };
      const r = right as { rightResult: { out: string } };
      return `${l.leftResult.out}:${r.rightResult.out}`;
    })
    .returns((state) => ({ combined: state.combined }));

  const result = wf.forward({} as any, { input: 'hello' });
  type _result = Expect<Equal<typeof result, Promise<{ combined: string }>>>;
}

// removed terminal shaper APIs stay removed
{
  const wf = flow<{ input: string }>();
  // @ts-expect-error mapOutput() was removed
  wf.mapOutput((state: { input: string }) => ({ input: state.input }));
  // @ts-expect-error mo() was removed
  wf.mo((state: { input: string }) => ({ input: state.input }));
}
