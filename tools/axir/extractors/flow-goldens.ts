import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AxAIService } from '../../../src/ax/ai/types.js';
import { AxSignature, f } from '../../../src/ax/dsp/sig.js';
import type {
  AxChatLogEntry,
  AxProgramUsage,
} from '../../../src/ax/dsp/types.js';
import { AxFlowExecutionPlanner } from '../../../src/ax/flow/executionPlanner.js';
import { executeFlowSteps } from '../../../src/ax/flow/executor.js';
import { flow } from '../../../src/ax/flow/flow.js';
import { createFlowStep, toPlanStep } from '../../../src/ax/flow/steps.js';

type Fixture = Record<string, unknown>;

const root = process.env.AXIR_CONFORMANCE_OUT_ROOT ?? process.cwd();
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
    'src/ax/flow/steps.ts',
    'src/ax/flow/executor.ts',
    'src/ax/flow/executionPlanner.ts',
    'src/ax/flow/mermaid.ts',
    'src/ax/flow/dependencyAnalyzer.ts',
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
) => {
  const toPortableStep = (step: NonNullable<typeof plan.steps>[number]) => ({
    name: step.nodeName ?? step.produces[0] ?? step.type,
    kind: step.type,
    reads: step.dependencies,
    writes: step.produces,
    barrier: step.isBarrier,
    stepIndex: step.stepIndex,
  });
  return {
    totalSteps: plan.totalSteps,
    parallelGroups: plan.parallelGroups,
    maxParallelism: plan.maxParallelism,
    steps: (plan.steps ?? []).map(toPortableStep),
    groups: (plan.groups ?? []).map((group) => ({
      level: group.level,
      steps: group.steps.map((step) => toPortableStep(step)),
    })),
  };
};

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
        options: {
          reads: ['question'],
          writes: ['qaResult'],
          isBarrier: false,
        },
      },
    ],
    returns: { answer: 'answer' },
    responses: [
      {
        content: '{"answer":"Paris"}',
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      },
    ],
    expected_output: { answer: 'Paris' },
    expected_request_count: 1,
    expected_chat_log_subset: [{ name: 'qa' }],
    expected_trace_kinds: [
      'flow_start',
      'flow_step',
      'flow_child_trace',
      'flow_done',
    ],
    expected_trace_subset: [{ kind: 'flow_child_trace', name: 'qa' }],
    expected_usage_subset: {
      qa: [{ prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }],
    },
    expected_components_subset: [
      { id: 'qa.flow::graph-plan', kind: 'flow-graph' },
    ],
  });
};

const writeExecutionRuntimeFixtures = async () => {
  const dynamicProgram = new ScriptedProgram(
    'question:string -> answer:string',
    { answer: 'dynamic' }
  );
  const dynamicFlow = flow<{ question: string }, { answer: string }>()
    .node('qa', dynamicProgram)
    .execute('qa', (state) => ({ question: state.question }))
    .returns((state) => ({ answer: String((state as any).qaResult.answer) }));
  const dynamicOut = await dynamicFlow.forward(
    { name: 'mock' } as unknown as AxAIService,
    { question: 'dynamic?' },
    { model: 'gpt-flow-fixture', traceLabel: 'outer' } as any
  );

  writeFixture(flowDir, 'dynamic-options-trace-label.json', {
    kind: 'flow',
    name: 'dynamic-options-trace-label',
    source: source('dynamic-options-trace-label', {
      output: dynamicOut,
      childCallOptions: dynamicProgram.calls[0]?.options,
    }),
    input: { question: 'dynamic?' },
    steps: [
      {
        kind: 'execute',
        name: 'qa',
        signature: 'question:string -> answer:string',
        options: {
          reads: ['question'],
          writes: ['qaResult'],
          isBarrier: false,
        },
      },
    ],
    returns: { answer: 'answer' },
    forward_options: { model: 'gpt-flow-fixture', traceLabel: 'outer' },
    responses: [{ content: '{"answer":"dynamic"}' }],
    expected_output: { answer: 'dynamic' },
    expected_request_count: 1,
    expected_request_contains: ['gpt-flow-fixture'],
  });

  writeFixture(flowDir, 'explicit-parallel-merge-execution.json', {
    kind: 'flow',
    name: 'explicit-parallel-merge-execution',
    source: source('explicit-parallel-merge-execution', {
      rule: 'Explicit parallel and merge are barriers but still shape state deterministically.',
    }),
    input: { question: 'parallel?' },
    steps: [
      {
        kind: 'parallel',
        name: '_parallelResults',
        options: {
          writes: ['_parallelResults'],
          isBarrier: true,
          parallel_results: [{ left: 'l' }, { right: 'r' }],
        },
      },
      {
        kind: 'parallelMerge',
        name: 'combined',
        options: {
          reads: ['_parallelResults'],
          writes: ['combined'],
          isBarrier: true,
        },
      },
    ],
    returns: { combined: 'combined' },
    expected_output: { combined: [{ left: 'l' }, { right: 'r' }] },
    expected_request_count: 0,
  });

  const innerProgram = new ScriptedProgram('question:string -> answer:string', {
    answer: 'Nested Paris',
  });
  const innerFlow = flow<{ question: string }, { answer: string }>()
    .node('inner', innerProgram)
    .execute('inner', (state) => ({ question: state.question }))
    .returns((state) => ({
      answer: String((state as any).innerResult.answer),
    }));
  const outerFlow = flow<{ question: string }, { answer: string }>()
    .node('nested', innerFlow as any)
    .execute('nested', (state) => ({ question: state.question }))
    .returns((state) => ({
      answer: String((state as any).nestedResult.answer),
    }));
  const nestedOut = await outerFlow.forward(
    { name: 'mock' } as unknown as AxAIService,
    { question: 'nested?' }
  );

  writeFixture(flowDir, 'nested-flow-program-call.json', {
    kind: 'flow',
    name: 'nested-flow-program-call',
    source: source('nested-flow-program-call', {
      output: nestedOut,
      chatLogNames: outerFlow.getChatLog().map((entry) => entry.name),
    }),
    input: { question: 'nested?' },
    steps: [
      {
        kind: 'execute',
        name: 'nested',
        program: 'flow',
        options: {
          reads: ['question'],
          writes: ['nestedResult'],
          isBarrier: false,
        },
        steps: [
          {
            kind: 'execute',
            name: 'inner',
            signature: 'question:string -> answer:string',
            options: {
              reads: ['question'],
              writes: ['innerResult'],
              isBarrier: false,
            },
          },
        ],
        returns: { answer: 'answer' },
      },
    ],
    returns: { answer: 'answer' },
    responses: [{ content: '{"answer":"Nested Paris"}' }],
    expected_output: { answer: 'Nested Paris' },
    expected_request_count: 1,
    expected_chat_log_subset: [{ name: 'nested.inner' }],
  });

  writeFixture(flowDir, 'abort-before-step.json', {
    kind: 'flow',
    name: 'abort-before-step',
    source: source('abort-before-step', {
      rule: 'TS checks abort before running a planned step.',
    }),
    input: { question: 'stop?' },
    steps: [
      {
        kind: 'execute',
        name: 'qa',
        signature: 'question:string -> answer:string',
      },
    ],
    forward_options: { abort_before_step: true },
    responses: [{ content: '{"answer":"never"}' }],
    expected_error_contains: 'Flow aborted',
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
        options: {
          reads: ['question'],
          writes: ['extractResult'],
          isBarrier: false,
        },
      },
      {
        kind: 'derive',
        name: 'draft',
        signature: 'facts:string -> draft:string',
        options: {
          reads: ['extractResult'],
          writes: ['draft'],
          isBarrier: false,
        },
      },
      { kind: 'map', name: 'map', output: { shaped: true } },
    ],
    returns: { final: 'draft' },
    expected_plan: normalizePlan(plannerFlow.getExecutionPlan()),
  });

  const independentFlow = flow<{ question: string }>({ autoParallel: true })
    .node(
      'left',
      new ScriptedProgram('question:string -> left:string', { left: 'l' })
    )
    .node(
      'right',
      new ScriptedProgram('question:string -> right:string', { right: 'r' })
    )
    .execute('left', (state) => ({ question: state.question }))
    .execute('right', (state) => ({ question: state.question }));

  writeFixture(flowDir, 'auto-parallel-independent-executes.json', {
    kind: 'flow',
    name: 'auto-parallel-independent-executes',
    operation: 'plan',
    source: source('auto-parallel-independent-executes', {
      plan: normalizePlan(independentFlow.getExecutionPlan()),
    }),
    steps: [
      {
        kind: 'execute',
        name: 'left',
        signature: 'question:string -> left:string',
        options: {
          reads: ['question'],
          writes: ['leftResult'],
          isBarrier: false,
        },
      },
      {
        kind: 'execute',
        name: 'right',
        signature: 'question:string -> right:string',
        options: {
          reads: ['question'],
          writes: ['rightResult'],
          isBarrier: false,
        },
      },
    ],
    expected_plan: normalizePlan(independentFlow.getExecutionPlan()),
  });

  const unknownReadFlow = flow<{ question: string }>({ autoParallel: true })
    .node(
      'unsafe',
      new ScriptedProgram('question:string -> answer:string', { answer: 'x' })
    )
    .execute('unsafe', (state) => ({
      question: (state as any)[String('question')],
    }));

  writeFixture(flowDir, 'unknown-state-read-barrier.json', {
    kind: 'flow',
    name: 'unknown-state-read-barrier',
    operation: 'plan',
    source: source('unknown-state-read-barrier', {
      plan: normalizePlan(unknownReadFlow.getExecutionPlan()),
    }),
    steps: [
      {
        kind: 'execute',
        name: 'unsafe',
        signature: 'question:string -> answer:string',
        options: {
          reads: [],
          writes: ['unsafeResult'],
          isBarrier: true,
        },
      },
    ],
    expected_plan: normalizePlan(unknownReadFlow.getExecutionPlan()),
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
    steps: [
      {
        kind: 'parallel',
        name: '_parallelResults',
        options: {
          writes: ['_parallelResults'],
          isBarrier: true,
        },
      },
      {
        kind: 'parallelMerge',
        name: 'combined',
        options: {
          reads: ['_parallelResults'],
          writes: ['combined'],
          isBarrier: true,
        },
      },
    ],
    expected_plan: normalizePlan(parallelFlow.getExecutionPlan()),
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

  const directStep = createFlowStep({
    kind: 'map',
    reads: ['firstName', 'lastName'],
    writes: ['fullName'],
    isBarrier: true,
    run: (state) => ({
      ...state,
      fullName: `${state.firstName} ${state.lastName}`,
    }),
  });
  const directPlan = new AxFlowExecutionPlanner([
    directStep,
  ]).getExecutionPlan();
  const directResult = await executeFlowSteps(
    [directStep],
    { firstName: 'Ada', lastName: 'Lovelace' },
    {
      mainAi: { name: 'mock' } as unknown as AxAIService,
      autoParallel: true,
      executeSteps: async () => ({}),
      checkAbort: () => {},
    },
    { autoParallel: true }
  );

  writeFixture(flowDir, 'executor-step-contract.json', {
    kind: 'flow',
    name: 'executor-step-contract',
    operation: 'plan',
    source: source('executor-step-contract', {
      plan: normalizePlan(directPlan),
      firstPlanStep: toPlanStep(directStep, 0),
      executorResult: directResult.finalState,
    }),
    steps: [
      {
        kind: 'map',
        name: 'fullName',
        output: { fullName: 'Ada Lovelace' },
        options: {
          reads: ['firstName', 'lastName'],
          writes: ['fullName'],
          isBarrier: true,
        },
      },
    ],
    expected_plan: normalizePlan(directPlan),
  });
};

const writeControlFlowRuntimeFixtures = async () => {
  const ai = { name: 'mock' } as unknown as AxAIService;

  const whileFlow = flow<{ count: number }, { count: number }>()
    .while((state) => state.count < 3)
    .map((state) => ({ ...state, count: state.count + 1 }))
    .endWhile()
    .returns((state) => ({ count: state.count }));
  const whileOut = await whileFlow.forward(ai, { count: 0 });

  writeFixture(flowDir, 'control-while-execution.json', {
    kind: 'flow',
    name: 'control-while-execution',
    source: source('control-while-execution', {
      output: whileOut,
      plan: normalizePlan(whileFlow.getExecutionPlan()),
    }),
    input: { count: 0 },
    steps: [
      {
        kind: 'while',
        name: 'countLoop',
        condition: { op: 'lt', field: 'count', value: 3 },
        options: { maxIterations: 100 },
        steps: [
          {
            kind: 'map',
            name: 'incrementCount',
            mapper: { op: 'increment', field: 'count' },
          },
        ],
      },
    ],
    returns: { count: 'count' },
    expected_output: { count: 3 },
    expected_request_count: 0,
  });

  const branchFlow = flow<{ needsComplex: boolean }, { strategy: string }>()
    .branch((state) => state.needsComplex)
    .when(true)
    .map((state) => ({ ...state, strategy: 'complex' }))
    .when(false)
    .map((state) => ({ ...state, strategy: 'simple' }))
    .merge()
    .returns((state) => ({ strategy: String((state as any).strategy) }));
  const branchOut = await branchFlow.forward(ai, { needsComplex: true });

  writeFixture(flowDir, 'control-branch-execution.json', {
    kind: 'flow',
    name: 'control-branch-execution',
    source: source('control-branch-execution', {
      output: branchOut,
      plan: normalizePlan(branchFlow.getExecutionPlan()),
    }),
    input: { needsComplex: true },
    steps: [
      {
        kind: 'branch',
        name: 'strategyBranch',
        predicate: { op: 'field', field: 'needsComplex' },
        branches: [
          {
            when: true,
            steps: [
              {
                kind: 'map',
                name: 'complexPath',
                mapper: { op: 'set', values: { strategy: 'complex' } },
              },
            ],
          },
          {
            when: false,
            steps: [
              {
                kind: 'map',
                name: 'simplePath',
                mapper: { op: 'set', values: { strategy: 'simple' } },
              },
            ],
          },
        ],
      },
    ],
    returns: { strategy: 'strategy' },
    expected_output: { strategy: 'complex' },
    expected_request_count: 0,
  });

  const feedbackFlow = flow<{ value: string }, { attempts: number }>()
    .map((state) => ({ ...state, attempts: 0 }))
    .label('retry')
    .map((state) => ({ ...state, attempts: state.attempts + 1 }))
    .feedback((state) => state.attempts < 3, 'retry', 5)
    .returns((state) => ({ attempts: state.attempts }));
  const feedbackOut = await feedbackFlow.forward(ai, { value: 'x' });

  writeFixture(flowDir, 'control-feedback-execution.json', {
    kind: 'flow',
    name: 'control-feedback-execution',
    source: source('control-feedback-execution', {
      output: feedbackOut,
      plan: normalizePlan(feedbackFlow.getExecutionPlan()),
    }),
    input: { value: 'x' },
    steps: [
      {
        kind: 'map',
        name: 'initAttempts',
        mapper: { op: 'set', values: { attempts: 0 } },
      },
      {
        kind: 'map',
        name: 'firstAttempt',
        mapper: { op: 'increment', field: 'attempts' },
      },
      {
        kind: 'feedback',
        name: 'retry',
        condition: { op: 'lt', field: 'attempts', value: 3 },
        options: { maxIterations: 5, label: 'retry' },
        steps: [
          {
            kind: 'map',
            name: 'retryAttempt',
            mapper: { op: 'increment', field: 'attempts' },
          },
        ],
      },
    ],
    returns: { attempts: 'attempts' },
    expected_output: { attempts: 3 },
    expected_request_count: 0,
  });

  const nestedFlow = flow<
    { count: number },
    { count: number; strategy: string }
  >()
    .while((state) => state.count < 2)
    .branch((state) => state.count === 0)
    .when(true)
    .map((state) => ({ ...state, strategy: 'first' }))
    .when(false)
    .map((state) => ({ ...state, strategy: 'later' }))
    .merge()
    .map((state) => ({ ...state, count: state.count + 1 }))
    .endWhile()
    .returns((state) => ({
      count: state.count,
      strategy: String((state as any).strategy),
    }));
  const nestedOut = await nestedFlow.forward(ai, { count: 0 });

  writeFixture(flowDir, 'control-nested-branch-while.json', {
    kind: 'flow',
    name: 'control-nested-branch-while',
    source: source('control-nested-branch-while', {
      output: nestedOut,
      plan: normalizePlan(nestedFlow.getExecutionPlan()),
    }),
    input: { count: 0 },
    steps: [
      {
        kind: 'while',
        name: 'outerLoop',
        condition: { op: 'lt', field: 'count', value: 2 },
        steps: [
          {
            kind: 'branch',
            name: 'firstBranch',
            predicate: { op: 'eq', field: 'count', value: 0 },
            branches: [
              {
                when: true,
                steps: [
                  {
                    kind: 'map',
                    name: 'firstStrategy',
                    mapper: { op: 'set', values: { strategy: 'first' } },
                  },
                ],
              },
              {
                when: false,
                steps: [
                  {
                    kind: 'map',
                    name: 'laterStrategy',
                    mapper: { op: 'set', values: { strategy: 'later' } },
                  },
                ],
              },
            ],
          },
          {
            kind: 'map',
            name: 'incrementNestedCount',
            mapper: { op: 'increment', field: 'count' },
          },
        ],
      },
    ],
    returns: { count: 'count', strategy: 'strategy' },
    expected_output: { count: 2, strategy: 'later' },
    expected_request_count: 0,
  });

  writeFixture(flowDir, 'control-parallel-merge-missing-results-error.json', {
    kind: 'flow',
    name: 'control-parallel-merge-missing-results-error',
    source: source('control-parallel-merge-missing-results-error', {
      rule: 'TS throws when merge runs without parallel results.',
    }),
    input: {},
    steps: [
      {
        kind: 'parallelMerge',
        name: 'combined',
        options: {
          reads: ['_parallelResults'],
          writes: ['combined'],
          isBarrier: true,
        },
      },
    ],
    expected_error_contains: 'No parallel results found for merge',
  });

  writeFixture(flowDir, 'control-stop-during-running-node.json', {
    kind: 'flow',
    name: 'control-stop-during-running-node',
    source: source('control-stop-during-running-node', {
      rule: 'TS stop() aborts an in-flight node through the forwarded abort signal.',
    }),
    input: { question: 'stop during node?' },
    steps: [
      {
        kind: 'execute',
        name: 'slow',
        signature: 'question:string -> answer:string',
      },
    ],
    forward_options: { abort_during_step: true, abort_during_node: 'slow' },
    responses: [{ content: '{"answer":"never"}' }],
    expected_error_contains: 'Flow aborted at flow-node-slow',
  });

  writeFixture(flowDir, 'control-auto-parallel-flow-option-false.json', {
    kind: 'flow',
    name: 'control-auto-parallel-flow-option-false',
    source: source('control-auto-parallel-flow-option-false', {
      rule: 'TS does not re-enable constructor autoParallel:false from forward options.',
    }),
    flow_options: { autoParallel: false },
    input: { question: 'parallel?' },
    steps: [
      {
        kind: 'execute',
        name: 'left',
        signature: 'question:string -> left:string',
        options: {
          reads: ['question'],
          writes: ['leftResult'],
          isBarrier: false,
        },
      },
      {
        kind: 'execute',
        name: 'right',
        signature: 'question:string -> right:string',
        options: {
          reads: ['question'],
          writes: ['rightResult'],
          isBarrier: false,
        },
      },
    ],
    returns: { left: 'leftResult.left', right: 'rightResult.right' },
    forward_options: { autoParallel: true, record_flow_groups: true },
    responses: [{ content: '{"left":"l"}' }, { content: '{"right":"r"}' }],
    expected_output: { left: 'l', right: 'r' },
    expected_trace_kinds: [
      'flow_start',
      'flow_group',
      'flow_step',
      'flow_child_trace',
      'flow_group',
      'flow_step',
      'flow_child_trace',
      'flow_group',
      'flow_done',
    ],
    expected_request_count: 2,
  });

  writeFixture(flowDir, 'control-auto-parallel-forward-override-false.json', {
    kind: 'flow',
    name: 'control-auto-parallel-forward-override-false',
    source: source('control-auto-parallel-forward-override-false', {
      rule: 'TS forward autoParallel:false forces sequential execution for that run.',
    }),
    input: { question: 'override?' },
    steps: [
      {
        kind: 'execute',
        name: 'left',
        signature: 'question:string -> left:string',
        options: {
          reads: ['question'],
          writes: ['leftResult'],
          isBarrier: false,
        },
      },
      {
        kind: 'execute',
        name: 'right',
        signature: 'question:string -> right:string',
        options: {
          reads: ['question'],
          writes: ['rightResult'],
          isBarrier: false,
        },
      },
    ],
    returns: { left: 'leftResult.left', right: 'rightResult.right' },
    forward_options: { autoParallel: false, record_flow_groups: true },
    responses: [{ content: '{"left":"l"}' }, { content: '{"right":"r"}' }],
    expected_output: { left: 'l', right: 'r' },
    expected_trace_kinds: [
      'flow_start',
      'flow_group',
      'flow_step',
      'flow_child_trace',
      'flow_group',
      'flow_step',
      'flow_child_trace',
      'flow_group',
      'flow_done',
    ],
    expected_request_count: 2,
  });

  const extendedFlow = flow().nx(
    'reasoner',
    'userInput:string -> answer:string',
    {
      prependOutputs: [
        { name: 'reasoning', type: f.string('Reasoning').internal() },
      ],
    }
  );
  writeFixture(flowDir, 'control-node-extended-nx-signature.json', {
    kind: 'flow',
    name: 'control-node-extended-nx-signature',
    source: source('control-node-extended-nx-signature', {
      signature: extendedFlow.getSignature().toString(),
    }),
    input: { userInput: 'why?' },
    steps: [
      {
        kind: 'execute',
        name: 'reasoner',
        extended_signature:
          'userInput:string -> reasoning!:string, answer:string',
      },
    ],
    returns: { answer: 'reasonerResult.answer' },
    responses: [{ content: '{"reasoning":"because","answer":"ok"}' }],
    expected_output: { answer: 'ok' },
    expected_request_count: 1,
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

const writeMermaidFixtures = () => {
  const cases: Array<{
    name: string;
    document: string[];
    conditions?: string[];
  }> = [
    {
      name: 'mermaid-linear-extended-signature',
      document: [
        'flowchart TD',
        '  %%ax summarize: documentText:string -> summaryText:string(max 500) "concise summary"',
        '  %%ax format: summaryText:string -> finalReport:string',
        '  summarize[Summarize document] --> format([Format report])',
      ],
    },
    {
      name: 'mermaid-class-branch-join',
      document: [
        'flowchart LR',
        '  %%ax classify: requestText:string -> routeClass:class "support, sales"',
        '  %%ax supportReply: requestText:string -> replyText:string(max 300)',
        '  %%ax salesReply: requestText:string -> replyText:string(max 300)',
        '  %%ax send: replyText:string -> deliveredReply:string',
        '  classify{routeClass} -->|support| supportReply --> send',
        '  classify -->|sales| salesReply --> send',
      ],
    },
    {
      name: 'mermaid-feedback-loop',
      document: [
        'flowchart TD',
        '  %%ax draft: taskText:string -> draftText:string',
        '  %%ax review: draftText:string -> verdict:class "approve, revise"',
        '  draft --> review{verdict}',
        '  review -->|revise, max 3| draft',
      ],
    },
    {
      name: 'mermaid-while-loop-binding',
      conditions: ['keepPolishing'],
      document: [
        'flowchart TD',
        '  %%ax polish: draftText:string -> polishedText:string',
        '  polish -->|while keepPolishing, max 5| polish',
      ],
    },
    {
      name: 'mermaid-fan-out-and-in',
      document: [
        'flowchart TD',
        '  %%ax split: topicText:string -> questionText:string',
        '  %%ax alpha: questionText:string -> alphaAnswer:string',
        '  %%ax beta: questionText:string -> betaAnswer:string',
        '  %%ax joiner: alphaAnswer:string, betaAnswer:string -> combinedAnswer:string',
        '  split --> alpha & beta',
        '  alpha & beta --> joiner',
      ],
    },
    {
      name: 'mermaid-supported-shapes',
      document: [
        'flowchart BT',
        '  %%ax alpha: inputText:string -> alphaText:string',
        '  %%ax beta: alphaText:string -> betaText:string',
        '  %%ax gamma: betaText:string -> gammaText:string',
        '  alpha((Alpha)) --> beta(Beta) --> gamma([Gamma])',
      ],
    },
    {
      name: 'mermaid-chain-roundtrip',
      document: [
        'graph RL',
        '  %%ax first: seedText:string -> firstText:string',
        '  %%ax second: firstText:string -> secondText:string',
        '  %%ax third: secondText:string -> finalText:string',
        '  first --> second --> third',
      ],
    },
  ];

  for (const item of cases) {
    const document = item.document.join('\n');
    const conditions = Object.fromEntries(
      (item.conditions ?? []).map((name) => [name, () => false])
    );
    const bindings = item.conditions ? { conditions } : undefined;
    const first = flow(document, bindings);
    const rendered = String(first);
    const rerendered = String(flow(rendered, bindings));
    writeFixture(flowDir, `${item.name}.json`, {
      kind: 'flow_mermaid',
      name: item.name,
      source: source(item.name, {
        rendered,
        rerendered,
        plan: first.getExecutionPlan(),
      }),
      document,
      condition_names: item.conditions ?? [],
      expected_rendered: rendered,
      expected_rerendered: rerendered,
      expected_direction: first.getExecutionPlan()
        ? item.document[0]?.split(' ')[1]
        : 'TD',
    });
  }

  const built = flow<{ documentText: string }>()
    .node('summarize', 'documentText:string -> summaryText:string')
    .node('format', 'summaryText:string -> finalReport:string')
    .execute('summarize', (state) => ({ documentText: state.documentText }))
    .execute('format', (state) => ({
      summaryText: state.summarizeResult.summaryText,
    }));
  writeFixture(flowDir, 'mermaid-render-from-builder.json', {
    kind: 'flow_mermaid',
    name: 'mermaid-render-from-builder',
    operation: 'builder_render',
    source: source('mermaid-render-from-builder', { rendered: String(built) }),
    builder_steps: [
      {
        name: 'summarize',
        signature: 'documentText:string -> summaryText:string',
        reads: [],
      },
      {
        name: 'format',
        signature: 'summaryText:string -> finalReport:string',
        reads: ['summarizeResult'],
      },
    ],
    expected_rendered: String(built),
  });

  const errors: Array<{ name: string; document: string[]; expected: string }> =
    [
      {
        name: 'mermaid-error-missing-header',
        document: ['alpha --> beta'],
        expected: 'Missing flowchart header',
      },
      {
        name: 'mermaid-error-subgraph',
        document: ['flowchart TD', 'subgraph one', 'a --> b', 'end'],
        expected: 'Unsupported mermaid construct',
      },
      {
        name: 'mermaid-error-unlabeled-back-edge',
        document: [
          'flowchart TD',
          '%%ax alpha: aText:string -> bText:string',
          '%%ax beta: bText:string -> cText:string',
          'alpha --> beta',
          'beta --> alpha',
        ],
        expected: 'Back-edges need a label',
      },
      {
        name: 'mermaid-error-no-signature',
        document: ['flowchart TD', 'mystery --> other'],
        expected: 'No signature for node(s): mystery, other',
      },
      {
        name: 'mermaid-error-ambiguous-producers',
        document: [
          'flowchart TD',
          '%%ax alpha: topicText:string -> answerText:string',
          '%%ax beta: topicText:string -> answerText:string',
          '%%ax joiner: answerText:string -> finalText:string',
          'alpha & beta --> joiner',
        ],
        expected: 'produced by alpha and beta at the same distance',
      },
      {
        name: 'mermaid-error-missing-condition',
        document: [
          'flowchart TD',
          '%%ax polish: draftText:string -> polishedText:string',
          'polish -->|while missingCond| polish',
        ],
        expected: 'Missing condition binding "missingCond"',
      },
    ];
  for (const item of errors) {
    const document = item.document.join('\n');
    let message = '';
    try {
      flow(document);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    writeFixture(flowDir, `${item.name}.json`, {
      kind: 'flow_mermaid',
      name: item.name,
      operation: 'error',
      source: source(item.name, { error: message }),
      document,
      expected_error_contains: item.expected,
    });
  }
};

// Observe TS dependency semantics and results; the traced serial fallback is
// the explicit owned-worker compatibility policy of the generated targets.
const writeOwnedWorkerFallbackFixture = async () => {
  const left = new ScriptedProgram('question:string -> left:string', {
    left: 'l',
  });
  const right = new ScriptedProgram('question:string -> right:string', {
    right: 'r',
  });
  const program = flow<{ question: string }, { left: string; right: string }>()
    .node('left', left)
    .node('right', right)
    .execute('left', (state) => ({ question: state.question }))
    .execute('right', (state) => ({ question: state.question }))
    .returns((state) => ({
      left: String((state as any).leftResult.left),
      right: String((state as any).rightResult.right),
    }));
  const output = await program.forward(
    { name: 'mock' } as unknown as AxAIService,
    { question: 'override?' },
    { autoParallel: false }
  );
  const fixture = {
    kind: 'flow',
    name: 'owned-workers-custom-client-serial-fallback',
    input: {
      question: 'override?',
    },
    steps: [
      {
        kind: 'execute',
        name: 'left',
        signature: 'question:string -> left:string',
        options: {
          reads: ['question'],
          writes: ['leftResult'],
          isBarrier: false,
        },
      },
      {
        kind: 'execute',
        name: 'right',
        signature: 'question:string -> right:string',
        options: {
          reads: ['question'],
          writes: ['rightResult'],
          isBarrier: false,
        },
      },
    ],
    returns: {
      left: 'leftResult.left',
      right: 'rightResult.right',
    },
    forward_options: {},
    responses: [
      {
        content: '{"left":"l"}',
      },
      {
        content: '{"right":"r"}',
      },
    ],
    expected_trace_subset: [
      {
        kind: 'flow_parallel_fallback',
        payload: {
          reason: 'owned-worker-unavailable',
        },
      },
      {
        kind: 'flow_step',
        payload: {
          name: 'left',
        },
      },
      {
        kind: 'flow_step',
        payload: {
          name: 'right',
        },
      },
    ],
    expected_chat_log_subset: [
      {
        name: 'left',
        response: {
          content: '{"left":"l"}',
        },
      },
      {
        name: 'right',
        response: {
          content: '{"right":"r"}',
        },
      },
    ],
  };
  writeFixture(flowDir, 'owned-workers-custom-client-serial-fallback.json', {
    ...fixture,
    source: source(fixture.name, {
      output,
      nodeCalls: left.calls.length + right.calls.length,
      generatedCompatibilityPolicy:
        'Clients without owned workers preserve the TS plan and result, execute the group serially, and report flow_parallel_fallback.',
    }),
    expected_output: output,
    expected_request_count: left.calls.length + right.calls.length,
  });
};

// A ScriptedProgram that returns its scripted outputs in call order.
class QueuedProgram extends ScriptedProgram {
  private next = 0;

  constructor(
    signature: string,
    private readonly outputs: Record<string, unknown>[]
  ) {
    super(signature, outputs[0] ?? {});
  }

  override async forward(
    ai: Readonly<AxAIService>,
    values: Record<string, unknown>,
    options?: Record<string, unknown>
  ) {
    await super.forward(ai, values, options);
    const output = this.outputs[Math.min(this.next, this.outputs.length - 1)];
    this.next++;
    return output;
  }
}

// The reads, writes and barrier TS's planner gives each step of a step list,
// by node name (derive steps by their output field).
const planOptions = (steps: readonly unknown[]) => {
  const plan = new AxFlowExecutionPlanner(steps as any).getExecutionPlan();
  const byName = new Map<string, Record<string, unknown>>();
  for (const step of plan.steps ?? []) {
    byName.set(step.nodeName ?? step.produces[0] ?? step.type, {
      reads: [...step.dependencies],
      writes: [...step.produces],
      isBarrier: step.isBarrier,
    });
  }
  const groups = plan.groups.map((group) =>
    group.steps.map((step) => step.nodeName ?? step.produces[0] ?? step.type)
  );
  return { byName, groups };
};

const expectGroups = (label: string, actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label}: TS planned ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`
    );
  }
};

// A parallel group merges each step's changes: a later step in the group must
// not undo an earlier step's update to a key the state already held.
const writeParallelMergeFixtures = async () => {
  const ai = { name: 'mock' } as unknown as AxAIService;

  {
    const name = 'parallel-group-keeps-earlier-step-update';
    const a = new ScriptedProgram('topic:string -> summary:string', {
      summary: 'new',
    });
    const b = new ScriptedProgram('topic:string -> title:string', {
      title: 'title',
    });
    const wf = flow<{ topic: string; aResult?: unknown }>({
      autoParallel: true,
    })
      .node('a', a)
      .node('b', b)
      .execute('a', (state) => ({ topic: state.topic }))
      .execute('b', (state) => ({ topic: state.topic }))
      .returns((state) => ({
        aResult: (state as any).aResult,
        bResult: (state as any).bResult,
      }));
    const { byName, groups } = planOptions((wf as any).steps);
    expectGroups(name, groups, [['a', 'b'], ['returns']]);
    const input = { topic: 'x', aResult: { summary: 'old' } };
    const output = await wf.forward(ai, input);
    writeFixture(flowDir, `${name}.json`, {
      kind: 'flow',
      name,
      source: source(name, {
        output,
        plan: normalizePlan(wf.getExecutionPlan()),
        rule: 'A later step in a parallel group keeps an earlier step update to a key the state already held.',
      }),
      input,
      steps: [
        {
          kind: 'execute',
          name: 'a',
          signature: 'topic:string -> summary:string',
          options: byName.get('a'),
        },
        {
          kind: 'execute',
          name: 'b',
          signature: 'topic:string -> title:string',
          options: byName.get('b'),
        },
      ],
      returns: { aResult: 'aResult', bResult: 'bResult' },
      responses: [
        { content: '{"summary":"new"}' },
        { content: '{"title":"title"}' },
      ],
      expected_output: output,
      expected_request_count: 2,
    });
  }

  {
    const name = 'parallel-group-loop-keeps-each-iteration';
    const a = new QueuedProgram('topic:string -> summary:string', [
      { summary: 's1' },
      { summary: 's2' },
    ]);
    const b = new QueuedProgram('topic:string -> title:string', [
      { title: 't1' },
      { title: 't2' },
    ]);
    const wf = flow<{ topic: string; round: number }>({ autoParallel: true })
      .node('a', a)
      .node('b', b)
      .while((state) => state.round < 2)
      .execute('a', (state) => ({ topic: state.topic }))
      .execute('b', (state) => ({ topic: state.topic }))
      .map((state) => ({ ...state, round: state.round + 1 }))
      .endWhile()
      .returns((state) => ({
        aResult: (state as any).aResult,
        bResult: (state as any).bResult,
        round: state.round,
      }));
    const whileStep = (wf as any).steps[0];
    const { byName, groups } = planOptions(whileStep.meta.bodySteps);
    expectGroups(name, groups, [['a', 'b'], ['map']]);
    const input = { topic: 'x', round: 0 };
    const output = await wf.forward(ai, input);
    writeFixture(flowDir, `${name}.json`, {
      kind: 'flow',
      name,
      source: source(name, {
        output,
        rule: 'Each iteration of a while loop whose body runs a parallel group keeps its updates.',
      }),
      input,
      steps: [
        {
          kind: 'while',
          name: 'rounds',
          condition: { op: 'lt', field: 'round', value: 2 },
          options: { maxIterations: 5 },
          steps: [
            {
              kind: 'execute',
              name: 'a',
              signature: 'topic:string -> summary:string',
              options: byName.get('a'),
            },
            {
              kind: 'execute',
              name: 'b',
              signature: 'topic:string -> title:string',
              options: byName.get('b'),
            },
            {
              kind: 'map',
              name: 'nextRound',
              mapper: { op: 'increment', field: 'round' },
            },
          ],
        },
      ],
      returns: { aResult: 'aResult', bResult: 'bResult', round: 'round' },
      responses: [
        { content: '{"summary":"s1"}' },
        { content: '{"title":"t1"}' },
        { content: '{"summary":"s2"}' },
        { content: '{"title":"t2"}' },
      ],
      expected_output: output,
      expected_request_count: 4,
    });
  }

  {
    const name = 'parallel-group-loop-keeps-derive-update';
    const b = new QueuedProgram('topic:string -> title:string', [
      { title: 't1' },
      { title: 't2' },
    ]);
    const wf = flow<{ topic: string; round: number }>({ autoParallel: true })
      .node('b', b)
      .while((state) => state.round < 2)
      .derive('label', 'round', (value: number) => value)
      .execute('b', (state) => ({ topic: state.topic }))
      .map((state) => ({ ...state, round: state.round + 1 }))
      .endWhile()
      .returns((state) => ({
        label: (state as any).label,
        bResult: (state as any).bResult,
        round: state.round,
      }));
    const whileStep = (wf as any).steps[0];
    const { byName, groups } = planOptions(whileStep.meta.bodySteps);
    expectGroups(name, groups, [['label', 'b'], ['map']]);
    const input = { topic: 'x', round: 0 };
    const output = await wf.forward(ai, input);
    writeFixture(flowDir, `${name}.json`, {
      kind: 'flow',
      name,
      source: source(name, {
        output,
        rule: 'A derive step in a loop body parallel group keeps each iteration update.',
      }),
      input,
      steps: [
        {
          kind: 'while',
          name: 'rounds',
          condition: { op: 'lt', field: 'round', value: 2 },
          options: { maxIterations: 5 },
          steps: [
            {
              kind: 'derive',
              name: 'label',
              mapper: { op: 'copy', from: '__item', to: '__derived' },
              options: byName.get('label'),
            },
            {
              kind: 'execute',
              name: 'b',
              signature: 'topic:string -> title:string',
              options: byName.get('b'),
            },
            {
              kind: 'map',
              name: 'nextRound',
              mapper: { op: 'increment', field: 'round' },
            },
          ],
        },
      ],
      returns: { label: 'label', bResult: 'bResult', round: 'round' },
      responses: [{ content: '{"title":"t1"}' }, { content: '{"title":"t2"}' }],
      expected_output: output,
      expected_request_count: 2,
    });
  }
};

writeProgramFixtures();
writePlanFixtures();
await runSimpleForward();
await writeParallelMergeFixtures();
await writeOwnedWorkerFallbackFixture();
await writeExecutionRuntimeFixtures();
await writeMapAndCacheFixtures();
await writeControlFlowRuntimeFixtures();
writeDemoFixture();
writeMermaidFixtures();

console.log('wrote TS-derived AxFlow AxIR conformance fixtures');
