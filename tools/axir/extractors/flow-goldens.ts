import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AxAIService } from '../../../src/ax/ai/types.js';
import { AxSignature } from '../../../src/ax/dsp/sig.js';
import type {
  AxChatLogEntry,
  AxProgramUsage,
} from '../../../src/ax/dsp/types.js';
import { flow } from '../../../src/ax/flow/flow.js';

type Fixture = Record<string, unknown>;

const root = process.cwd();
const flowDir = join(root, 'ir', 'conformance', 'axflow');
const programDir = join(root, 'ir', 'conformance', 'axprogram');

const writeFixture = (dir: string, name: string, fixture: Fixture) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), `${JSON.stringify(fixture, null, 2)}\n`);
};

const source = (name: string, observed: Record<string, unknown> = {}) => ({
  tsDerived: true,
  extractor: 'tools/axir/extractors/flow-goldens.ts',
  reference: [
    'src/ax/flow/flow.ts',
    'src/ax/flow/executionPlanner.ts',
    'src/ax/dsp/program.ts',
  ],
  name,
  observed,
});

class ScriptedProgram {
  private id = 'root';
  private readonly signature: AxSignature;
  private demos: unknown[] = [];
  public readonly calls: Array<Record<string, unknown>> = [];

  constructor(
    signature: string,
    private readonly output: Record<string, unknown>,
    private readonly logName?: string
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

  async forward(
    _ai: Readonly<AxAIService>,
    values: Record<string, unknown>,
    options?: Record<string, unknown>
  ) {
    this.calls.push({ values, options: options ?? {} });
    return this.output;
  }

  setDemos(demos: readonly unknown[]) {
    this.demos = [...demos];
  }

  getDemos() {
    return this.demos;
  }

  getUsage(): AxProgramUsage[] {
    return [
      {
        ai: 'mock',
        model: 'scripted',
        tokens: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      },
    ];
  }

  getTraces() {
    return [{ programId: this.id, trace: this.output }];
  }

  getChatLog(): readonly AxChatLogEntry[] {
    return [
      {
        name: this.logName,
        model: 'scripted',
        messages: [
          { role: 'user', content: 'fixture input' },
          { role: 'assistant', content: JSON.stringify(this.output) },
        ],
      },
    ];
  }

  resetUsage() {}

  getOptimizableComponents() {
    return [
      {
        id: `${this.id}::instruction`,
        owner: this.id,
        kind: 'instruction',
        current: '',
      },
    ];
  }
}

const normalizePlan = (
  plan: ReturnType<ReturnType<typeof flow>['getExecutionPlan']>
) =>
  (plan.steps ?? []).map((step) => ({
    name: step.nodeName ?? (step.type === 'map' ? 'map' : step.type),
    kind: step.type,
    barrier: !['execute', 'derive'].includes(step.type),
  }));

const runSimpleForward = async () => {
  const program = new ScriptedProgram('question:string -> answer:string', {
    answer: 'Paris',
  });
  const wf = flow<{ question: string }, { answer: string }>({
    autoParallel: true,
  })
    .node('qa', program)
    .execute('qa', (state) => ({ question: state.question }))
    .returns((state) => ({ answer: String((state as any).qaResult.answer) }));

  const observedPlan = wf.getExecutionPlan();
  const out = await wf.forward({ name: 'mock' } as unknown as AxAIService, {
    question: 'Capital of France?',
  });

  writeFixture(flowDir, 'simple-forward-returns.json', {
    kind: 'flow',
    name: 'simple-forward-returns',
    program_id: 'qa.flow',
    source: source('simple-forward-returns', {
      output: out,
      plan: normalizePlan(observedPlan),
      chatLogNames: wf.getChatLog().map((entry) => entry.name),
      usageCount: wf.getUsage().length,
      traceCount: wf.getTraces().length,
    }),
    input: { question: 'Capital of France?' },
    steps: [
      {
        kind: 'execute',
        name: 'qa',
        signature: 'question:string -> answer:string',
      },
    ],
    returns: { answer: 'answer' },
    responses: [{ content: '{"answer":"Paris"}' }],
    expected_output: { answer: 'Paris' },
    expected_request_count: 1,
    expected_chat_log_subset: [{ name: 'qa' }],
    expected_trace_kinds: ['flow_start', 'flow_step', 'flow_done'],
    expected_components_subset: [
      { id: 'qa.flow::graph-plan', kind: 'flow-graph' },
    ],
  });
};

const writePlanFixtures = () => {
  const plannerFlow = flow<{ question: string }>({ autoParallel: true })
    .node(
      'extract',
      new ScriptedProgram('question:string -> facts:string', { facts: 'f' })
    )
    .execute('extract', (state) => ({ question: state.question }))
    .derive('draft', 'extractResult', (value) => JSON.stringify(value))
    .map((state) => ({ ...state, shaped: true }))
    .returns((state) => ({ final: String((state as any).draft) }));

  writeFixture(flowDir, 'plan-barriers.json', {
    kind: 'flow',
    name: 'plan-barriers',
    operation: 'plan',
    source: source('plan-barriers', {
      plan: normalizePlan(plannerFlow.getExecutionPlan()),
    }),
    steps: [
      {
        kind: 'execute',
        name: 'extract',
        signature: 'question:string -> facts:string',
      },
      {
        kind: 'derive',
        name: 'draft',
        signature: 'facts:string -> draft:string',
      },
      { kind: 'map', name: 'shape', output: { shaped: true } },
    ],
    returns: { final: 'draft' },
    expected_plan: [
      { name: 'extract', kind: 'execute', barrier: false },
      { name: 'draft', kind: 'derive', barrier: false },
      { name: 'shape', kind: 'map', barrier: true },
      { name: 'returns', kind: 'returns', barrier: true },
    ],
  });

  const parallelFlow = flow<{ question: string }>({ autoParallel: true })
    .node(
      'left',
      new ScriptedProgram('question:string -> left:string', { left: 'l' })
    )
    .node(
      'right',
      new ScriptedProgram('question:string -> right:string', { right: 'r' })
    );
  parallelFlow
    .parallel([
      (ctx) => ctx.execute('left', (state) => ({ question: state.question })),
      (ctx) => ctx.execute('right', (state) => ({ question: state.question })),
    ])
    .merge('combined', (...results) => results);

  writeFixture(flowDir, 'explicit-parallel-barrier.json', {
    kind: 'flow',
    name: 'explicit-parallel-barrier',
    operation: 'plan',
    source: source('explicit-parallel-barrier', {
      plan: normalizePlan(parallelFlow.getExecutionPlan()),
    }),
    steps: [{ kind: 'parallel', name: 'parallelGroup' }],
    expected_plan: [{ name: 'parallelGroup', kind: 'parallel', barrier: true }],
  });
};

const writeMapAndCacheFixtures = async () => {
  const mapOnly = flow<
    { firstName: string; lastName: string },
    { fullName: string }
  >({
    autoParallel: false,
  })
    .map((state) => ({
      fullName: `${state.firstName} ${state.lastName}`,
    }))
    .returns((state) => ({ fullName: String((state as any).fullName) }));

  const out = await mapOnly.forward(
    { name: 'mock' } as unknown as AxAIService,
    {
      firstName: 'Ada',
      lastName: 'Lovelace',
    }
  );

  writeFixture(flowDir, 'map-state-merge-returns.json', {
    kind: 'flow',
    name: 'map-state-merge-returns',
    source: source('map-state-merge-returns', { output: out }),
    input: { firstName: 'Ada', lastName: 'Lovelace' },
    steps: [
      {
        kind: 'map',
        name: 'fullName',
        output: { fullName: 'Ada Lovelace' },
      },
    ],
    returns: { fullName: 'fullName' },
    expected_output: { fullName: 'Ada Lovelace' },
    expected_request_count: 0,
  });

  writeFixture(flowDir, 'cache-key-stable-input-order.json', {
    kind: 'flow',
    name: 'cache-key-stable-input-order',
    operation: 'cache_key',
    source: source('cache-key-stable-input-order', {
      rule: 'TS Flow hashes sorted object keys from actual input values.',
    }),
    cache_key_inputs: [
      { lastName: 'Lovelace', firstName: 'Ada' },
      { firstName: 'Ada', lastName: 'Lovelace' },
    ],
    expected_cache_keys_equal: true,
  });
};

const writeProgramFixtures = () => {
  writeFixture(programDir, 'axgen-component-contract.json', {
    kind: 'program_contract',
    name: 'axgen-component-contract',
    source: source('axgen-component-contract'),
    program: 'axgen',
    signature: '"Answer questions." question:string -> answer:string',
    options: { id: 'qa' },
    expected_component_ids: ['qa::description', 'qa::instruction'],
  });

  writeFixture(programDir, 'flow-component-contract.json', {
    kind: 'program_contract',
    name: 'flow-component-contract',
    source: source('flow-component-contract'),
    program: 'flow',
    program_id: 'root.flow',
    steps: [
      {
        kind: 'execute',
        name: 'qa',
        signature: 'question:string -> answer:string',
      },
    ],
    expected_components_subset: [
      { id: 'root.flow::graph-plan', owner: 'root.flow', kind: 'flow-graph' },
    ],
  });
};

const writeDemoFixture = () => {
  const wf = flow<{ question: string }>()
    .node(
      'qa',
      new ScriptedProgram('question:string -> answer:string', { answer: 'x' })
    )
    .execute('qa', (state) => ({ question: state.question }));
  let message = '';
  try {
    wf.setDemos([{ programId: 'root.missing', traces: [] }]);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  writeFixture(flowDir, 'demos-node-typo.json', {
    kind: 'flow',
    name: 'demos-node-typo',
    source: source('demos-node-typo', { error: message }),
    steps: [
      {
        kind: 'execute',
        name: 'qa',
        signature: 'question:string -> answer:string',
      },
    ],
    demos: [{ programId: 'root.missing', traces: [] }],
    expected_error_contains: 'Unknown program ID',
  });
};

writeProgramFixtures();
writePlanFixtures();
await runSimpleForward();
await writeMapAndCacheFixtures();
writeDemoFixture();

console.log('wrote TS-derived AxFlow AxIR conformance fixtures');
