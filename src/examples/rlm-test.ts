import { AxJSRuntime, agent, f, fn } from '@ax-llm/ax';

const runtime = new AxJSRuntime();

export const testTools = [
  fn('sum')
    .description('Return the sum of the provided numeric values')
    .namespace('math')
    .arg('values', f.number('Value to add').array())
    .returns(f.number('Sum of all values'))
    .handler(async ({ values }) =>
      values.reduce((total, value) => total + value, 0)
    )
    .build(),
];

export const rlmTestAgent = agent(
  'label:string, values:number[] -> answer:string',
  {
    contextFields: ['label', 'values'],
    runtime,
    functions: { local: testTools },
    contextPolicy: {
      preset: 'adaptive',
    },
  }
);

const snippetOutput = await rlmTestAgent.test(
  [
    'const total = await math.sum({ values });',
    'console.log(String(label) + ": " + String(total))',
  ].join('\n'),
  { label: 'sum the values', values: [3, 5, 8] }
);

const inspectOutput = await rlmTestAgent.test(
  [
    'const total = await math.sum({ values });',
    'globalThis.lastTotal = total;',
    'console.log([String(label), typeof inspect_runtime, String(lastTotal)].join(" | "))',
  ].join('\n'),
  { label: 'inspect runtime', values: [3, 5, 8] }
);

console.log(snippetOutput);
console.log('---');
console.log(inspectOutput);
