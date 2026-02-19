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
