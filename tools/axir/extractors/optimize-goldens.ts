import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  adjustEvalScoreForActions,
  buildAgentJudgeCriteria,
  mapAgentJudgeQualityToScore,
  normalizeAgentEvalDataset,
  resolveAgentOptimizeTargetIds,
} from '../../../src/ax/agent/optimize.js';
import { AxSignature } from '../../../src/ax/dsp/sig.js';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Fixture = Record<string, Json>;

const outDir = join(process.cwd(), 'ir/conformance/axoptimize');

function stable(value: unknown, parentKey = ''): unknown {
  if (Array.isArray(value)) return value.map((item) => stable(item, parentKey));
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const ordered =
      parentKey === 'input' ||
      parentKey === 'output' ||
      parentKey === 'expected_output' ||
      parentKey === 'component_map' ||
      parentKey === 'componentMap' ||
      parentKey === 'engine_response'
        ? entries
        : entries.sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(
      ordered.map(([key, item]) => [key, stable(item, key)])
    );
  }
  return value;
}

function writeFixture(name: string, fixture: Fixture): void {
  writeFileSync(
    join(outDir, `${name}.json`),
    `${JSON.stringify(stable({ name, ...fixture }), null, 2)}\n`
  );
}

function touchReferenceBehavior(): void {
  AxSignature.create('question:string -> answer:string');
  buildAgentJudgeCriteria('Prefer grounded answers.');
  mapAgentJudgeQualityToScore('excellent');
  normalizeAgentEvalDataset([{ input: { question: 'Capital?' } }] as any);
  adjustEvalScoreForActions(
    0.8,
    {
      input: { question: 'Capital?' },
      expectedActions: ['search_docs'],
    } as any,
    {
      completionType: 'final',
      output: { answer: 'Paris' },
      actionLog: [],
      functionCalls: [
        { name: 'search_docs', qualifiedName: 'tools.search_docs' },
      ],
      toolErrors: [],
      turnCount: 1,
    } as any
  );
  resolveAgentOptimizeTargetIds(
    [
      { id: 'ctx.root.actor' },
      { id: 'task.root.actor' },
      { id: 'task.root.responder' },
    ],
    'all'
  );
}

mkdirSync(outDir, { recursive: true });
for (const file of readdirSync(outDir)) {
  if (file.endsWith('.json')) rmSync(join(outDir, file));
}
touchReferenceBehavior();

writeFixture('axgen-component-inventory', {
  kind: 'optimize',
  operation: 'components',
  program: 'axgen',
  signature: 'query:string -> answer:string',
  options: { id: 'qa', instruction: 'Answer succinctly.' },
  tools: [
    {
      args: { query: { min: 1, type: 'string' } },
      description: 'Search docs',
      name: 'search_docs',
      result: { title: 'Docs' },
    },
  ],
  expected_components_subset: [
    {
      current: 'Answer succinctly.',
      id: 'qa::instruction',
      kind: 'instruction',
      owner: 'qa',
    },
    {
      current: 'Search docs',
      id: 'qa::fn:search_docs:desc',
      kind: 'fn-desc',
    },
    {
      current: 'search_docs',
      format: 'snake_case',
      id: 'qa::fn:search_docs:name',
      kind: 'fn-name',
    },
  ],
});

writeFixture('agent-component-inventory', {
  kind: 'optimize',
  operation: 'components',
  program: 'agent',
  signature: 'question:string -> answer:string',
  expected_components_subset: [
    { id: 'ctx.root.actor::instruction', kind: 'instruction' },
    { id: 'task.root.actor::instruction', kind: 'instruction' },
    { id: 'task.root.responder::instruction', kind: 'instruction' },
    { id: 'root.agent.runtime', kind: 'runtime-policy' },
    { id: 'root.agent.policy', kind: 'agent-policy' },
  ],
});

writeFixture('agent-target-filter-actor', {
  kind: 'optimize',
  operation: 'filter',
  program: 'agent',
  signature: 'question:string -> answer:string',
  target: 'actor',
  expected_component_ids: [
    'ctx.root.actor::instruction',
    'task.root.actor::instruction',
  ],
});

writeFixture('agent-target-filter-responder', {
  kind: 'optimize',
  operation: 'filter',
  program: 'agent',
  signature: 'question:string -> answer:string',
  target: 'responder',
  expected_component_ids: ['task.root.responder::instruction'],
});

writeFixture('artifact-roundtrip', {
  kind: 'optimize',
  operation: 'artifact',
  program: 'agent',
  signature: 'question:string -> answer:string',
  component_map: {
    'task.root.responder::instruction': 'Respond with citations.',
  },
  metadata: { reference: 'src/ax/agent/optimize.ts' },
  expected_artifact_subset: {
    artifactVersion: 'axir-optimized-artifact-v1',
    componentMap: {
      'task.root.responder::instruction': 'Respond with citations.',
    },
    metadata: { reference: 'src/ax/agent/optimize.ts' },
    optimizerName: 'fixture',
  },
});

writeFixture('apply-agent-component-map', {
  kind: 'optimize',
  operation: 'apply',
  program: 'agent',
  signature: 'question:string -> answer:string',
  component_map: {
    'task.root.responder::instruction': 'Use evidence only.',
  },
  expected_changed_components: [
    {
      current: '',
      id: 'task.root.responder::instruction',
      next: 'Use evidence only.',
    },
  ],
  expected_components_subset: [
    {
      current: 'Use evidence only.',
      id: 'task.root.responder::instruction',
      kind: 'instruction',
    },
  ],
});

writeFixture('fake-engine-apply', {
  kind: 'optimize',
  operation: 'engine',
  program: 'agent',
  signature: 'question:string -> answer:string',
  dataset: [{ input: { question: 'Capital?' }, expected: { answer: 'Paris' } }],
  optimize_options: { target: 'responder' },
  engine_response: {
    componentMap: {
      'task.root.responder::instruction': 'Return concise final answers.',
    },
  },
  expected_engine_request_subset: {
    contractVersion: 'axir-optimize-contract-v1',
    programKind: 'axagent',
  },
  expected_artifact_subset: {
    artifactVersion: 'axir-optimized-artifact-v1',
    changedComponents: [
      {
        current: '',
        id: 'task.root.responder::instruction',
        next: 'Return concise final answers.',
      },
    ],
    componentMap: {
      'task.root.responder::instruction': 'Return concise final answers.',
    },
    optimizerName: 'fake',
  },
  expected_components_subset: [
    {
      current: 'Return concise final answers.',
      id: 'task.root.responder::instruction',
    },
  ],
});

writeFixture('invalid-unknown-component', {
  kind: 'optimize',
  operation: 'artifact',
  program: 'agent',
  signature: 'question:string -> answer:string',
  component_map: {
    'missing::instruction': 'Nope.',
  },
  expected_error_contains: 'unknown optimized component id',
});

writeFixture('eval-prediction-final', {
  kind: 'optimize',
  operation: 'eval',
  program: 'agent',
  signature: 'question:string -> answer:string',
  task: { input: { question: 'Capital of France?' } },
  responses: [
    {
      content:
        '{"completion":{"type":"final","args":["Answer the question",{}]}}',
    },
    {
      content:
        '{"completion":{"type":"final","args":["Answer the question",{"answer":"Paris"}]}}',
    },
    { content: '{"answer":"Paris"}' },
  ],
  expected_prediction_subset: {
    completionType: 'final',
    output: { answer: 'Paris' },
  },
});

writeFixture('dataset-normalization-array', {
  kind: 'optimize',
  operation: 'dataset',
  dataset: [
    { input: { question: 'Capital?' }, expectedOutput: { answer: 'Paris' } },
  ],
  expected_dataset: {
    train: [
      { input: { question: 'Capital?' }, expectedOutput: { answer: 'Paris' } },
    ],
    validation: [],
  },
});

writeFixture('dataset-normalization-split', {
  kind: 'optimize',
  operation: 'dataset',
  dataset: {
    train: [{ input: { question: 'Train?' }, score: 0.7 }],
    validation: [{ input: { question: 'Validation?' }, score: 0.4 }],
  },
  expected_dataset: {
    train: [{ input: { question: 'Train?' }, score: 0.7 }],
    validation: [{ input: { question: 'Validation?' }, score: 0.4 }],
  },
});

writeFixture('metric-map-scalarization', {
  kind: 'optimize',
  operation: 'score',
  metric_score: { faithfulness: 0.8, helpfulness: 0.6 },
  score_options: { paretoMetricKey: 'faithfulness' },
  task: {},
  prediction: { functionCalls: [] },
  expected_scores: { faithfulness: 0.8, helpfulness: 0.6 },
  expected_scalar: 0.8,
});

const actionScoreTask = {
  expectedActions: ['search_docs', 'lookup'],
  forbiddenActions: ['delete_doc'],
} as any;
const actionScorePrediction = {
  functionCalls: [
    { name: 'search_docs', qualifiedName: 'tools.search_docs' },
    { name: 'delete_doc', qualifiedName: 'admin.delete_doc' },
  ],
} as any;

writeFixture('action-score-adjustment', {
  kind: 'optimize',
  operation: 'score',
  metric_score: 0.8,
  task: actionScoreTask,
  prediction: actionScorePrediction,
  expected_scores: { score: 0.8 },
  expected_scalar: adjustEvalScoreForActions(
    0.8,
    actionScoreTask,
    actionScorePrediction
  ),
});

writeFixture('judge-payload-quality-mapping', {
  kind: 'optimize',
  operation: 'judge_payload',
  criteria: buildAgentJudgeCriteria('Prefer concise grounded answers.'),
  quality: 'good',
  expected_quality_score: mapAgentJudgeQualityToScore('good'),
  task: {
    input: { question: 'Capital?' },
    criteria: 'Answer correctly.',
    expectedOutput: { answer: 'Paris' },
    expectedActions: ['search_docs'],
    metadata: { split: 'train' },
  },
  prediction: {
    completionType: 'final',
    output: { answer: 'Paris' },
    actionLog: ['runtime final'],
    functionCalls: [
      { name: 'search_docs', qualifiedName: 'tools.search_docs' },
    ],
    turnCount: 2,
    usage: { requests: 2 },
  },
  expected_judge_payload_subset: {
    taskInput: { question: 'Capital?' },
    criteria: 'Answer correctly.',
    expectedOutput: { answer: 'Paris' },
    expectedActions: ['search_docs'],
    metadata: { split: 'train' },
    completionType: 'final',
    finalOutput: { answer: 'Paris' },
    functionCalls: [
      { name: 'search_docs', qualifiedName: 'tools.search_docs' },
    ],
    turnCount: 2,
  },
});

writeFixture('candidate-evaluation-final-rollback', {
  kind: 'optimize',
  operation: 'evaluate',
  program: 'agent',
  signature: 'question:string -> answer:string',
  candidate_map: {
    'task.root.responder::instruction': 'Return only verified answers.',
  },
  dataset: [
    {
      input: { question: 'Capital of France?' },
      expectedOutput: { answer: 'Paris' },
      score: 1,
    },
  ],
  responses: [
    {
      content:
        '{"completion":{"type":"final","args":["Answer the question",{}]}}',
    },
    {
      content:
        '{"completion":{"type":"final","args":["Answer the question",{"answer":"Paris"}]}}',
    },
    { content: '{"answer":"Paris"}' },
  ],
  expected_evaluation_subset: {
    avg: 1,
    count: 1,
    candidateMap: {
      'task.root.responder::instruction': 'Return only verified answers.',
    },
  },
  expected_evaluation_rows_subset: [
    {
      prediction: {
        completionType: 'final',
        output: { answer: 'Paris' },
      },
      scalar: 1,
    },
  ],
  expected_components_subset_after: [
    {
      current: '',
      id: 'task.root.responder::instruction',
    },
  ],
});

writeFixture('candidate-evaluation-runtime-error', {
  kind: 'optimize',
  operation: 'evaluate',
  program: 'agent',
  signature: 'question:string -> answer:string',
  dataset: [{ input: { question: 'No response?' } }],
  responses: [],
  expected_evaluation_subset: {
    avg: 0,
    count: 1,
  },
  expected_evaluation_rows_subset: [
    {
      prediction: {
        completionType: 'error',
      },
      scalar: 0,
    },
  ],
});

writeFixture('candidate-evaluation-max-metric-calls', {
  kind: 'optimize',
  operation: 'evaluate',
  program: 'agent',
  signature: 'question:string -> answer:string',
  dataset: [{ input: { question: 'Blocked?' } }],
  eval_options: { maxMetricCalls: 0 },
  responses: [],
  expected_error_contains: 'max metric calls exceeded',
});

writeFixture('engine-evaluator-rollout', {
  kind: 'optimize',
  operation: 'engine',
  program: 'agent',
  signature: 'question:string -> answer:string',
  dataset: [
    {
      input: { question: 'Capital of France?' },
      expectedOutput: { answer: 'Paris' },
      score: 1,
    },
  ],
  responses: [
    {
      content:
        '{"completion":{"type":"final","args":["Answer the question",{}]}}',
    },
    {
      content:
        '{"completion":{"type":"final","args":["Answer the question",{"answer":"Paris"}]}}',
    },
    { content: '{"answer":"Paris"}' },
  ],
  engine_uses_evaluator: true,
  optimize_options: { target: 'responder' },
  engine_response: {
    evaluate: [
      {
        component_map: {
          'task.root.responder::instruction': 'Be precise.',
        },
      },
    ],
    componentMap: {
      'task.root.responder::instruction': 'Be precise.',
    },
  },
  expected_engine_request_subset: {
    contractVersion: 'axir-optimize-contract-v1',
    evaluator: {
      available: true,
      contractVersion: 'axir-optimizer-evaluator-v1',
    },
  },
  expected_engine_evaluations_subset: [
    {
      avg: 1,
      count: 1,
      candidateMap: {
        'task.root.responder::instruction': 'Be precise.',
      },
    },
  ],
  expected_artifact_subset: {
    artifactVersion: 'axir-optimized-artifact-v1',
    changedComponents: [
      {
        current: '',
        id: 'task.root.responder::instruction',
        next: 'Be precise.',
      },
    ],
    componentMap: {
      'task.root.responder::instruction': 'Be precise.',
    },
  },
  expected_components_subset: [
    {
      current: 'Be precise.',
      id: 'task.root.responder::instruction',
    },
  ],
});

writeFixture('engine-apply-false-preserves-components', {
  kind: 'optimize',
  operation: 'engine',
  program: 'agent',
  signature: 'question:string -> answer:string',
  dataset: [{ input: { question: 'Capital?' }, score: 1 }],
  optimize_options: { target: 'responder', apply: false },
  engine_response: {
    componentMap: {
      'task.root.responder::instruction': 'Do not apply me.',
    },
  },
  expected_artifact_subset: {
    artifactVersion: 'axir-optimized-artifact-v1',
    componentMap: {
      'task.root.responder::instruction': 'Do not apply me.',
    },
  },
  expected_components_subset: [
    {
      current: '',
      id: 'task.root.responder::instruction',
    },
  ],
});

writeFixture('flow-component-inventory-nested', {
  kind: 'optimize',
  operation: 'components',
  program: 'flow',
  program_id: 'root.flow',
  signature: 'question:string -> answer:string',
  steps: [
    {
      kind: 'execute',
      name: 'qa',
      signature: 'question:string -> answer:string',
      options: {
        id: 'qa',
        instruction: 'Base flow instruction.',
        reads: ['question'],
        writes: ['qaResult'],
      },
    },
    {
      kind: 'execute',
      name: 'nested',
      program: 'flow',
      options: { reads: ['question'], writes: ['nestedResult'] },
      steps: [
        {
          kind: 'execute',
          name: 'inner',
          signature: 'question:string -> answer:string',
          options: {
            id: 'inner',
            instruction: 'Nested child instruction.',
            reads: ['question'],
            writes: ['innerResult'],
          },
        },
      ],
      returns: { answer: 'answer' },
    },
  ],
  returns: { answer: 'answer' },
  expected_components_subset: [
    { id: 'root.flow::graph-plan', kind: 'flow-graph', owner: 'root.flow' },
    {
      id: 'root.flow.qa::qa::instruction',
      current: 'Base flow instruction.',
      kind: 'instruction',
      owner: 'root.flow.qa',
    },
    {
      id: 'root.flow.nested::root.nested::graph-plan',
      kind: 'flow-graph',
      owner: 'root.flow.nested',
    },
    {
      id: 'root.flow.nested::root.nested.inner::inner::instruction',
      current: 'Nested child instruction.',
      kind: 'instruction',
      owner: 'root.flow.nested',
    },
  ],
});

writeFixture('flow-target-filter-graph', {
  kind: 'optimize',
  operation: 'filter',
  program: 'flow',
  program_id: 'root.flow',
  signature: 'question:string -> answer:string',
  steps: [
    {
      kind: 'execute',
      name: 'qa',
      signature: 'question:string -> answer:string',
      options: {
        id: 'qa',
        instruction: 'Base flow instruction.',
        reads: ['question'],
        writes: ['qaResult'],
      },
    },
  ],
  returns: { answer: 'answer' },
  target: 'flow',
  expected_component_ids: ['root.flow::graph-plan'],
});

writeFixture('flow-apply-child-component', {
  kind: 'optimize',
  operation: 'apply',
  program: 'flow',
  program_id: 'root.flow',
  signature: 'question:string -> answer:string',
  steps: [
    {
      kind: 'execute',
      name: 'qa',
      signature: 'question:string -> answer:string',
      options: {
        id: 'qa',
        instruction: 'Base flow instruction.',
        reads: ['question'],
        writes: ['qaResult'],
      },
    },
  ],
  returns: { answer: 'answer' },
  component_map: {
    'root.flow.qa::qa::instruction': 'Use the optimized flow node prompt.',
  },
  expected_changed_components: [
    {
      id: 'root.flow.qa::qa::instruction',
      current: 'Base flow instruction.',
      next: 'Use the optimized flow node prompt.',
    },
  ],
  expected_components_subset: [
    {
      id: 'root.flow.qa::qa::instruction',
      current: 'Use the optimized flow node prompt.',
    },
  ],
});

writeFixture('flow-apply-graph-component', {
  kind: 'optimize',
  operation: 'apply',
  program: 'flow',
  program_id: 'root.flow',
  signature: 'question:string -> answer:string',
  steps: [
    {
      kind: 'execute',
      name: 'qa',
      signature: 'question:string -> answer:string',
      options: {
        id: 'qa',
        reads: ['question'],
        writes: ['qaResult'],
      },
    },
  ],
  returns: { answer: 'answer' },
  component_map: {
    'root.flow::graph-plan': {
      optimized: true,
      nodes: ['qa'],
    },
  },
  expected_components_subset: [
    {
      id: 'root.flow::graph-plan',
      current: {
        optimized: true,
        nodes: ['qa'],
      },
    },
  ],
});

writeFixture('flow-invalid-component', {
  kind: 'optimize',
  operation: 'apply',
  program: 'flow',
  program_id: 'root.flow',
  signature: 'question:string -> answer:string',
  steps: [
    {
      kind: 'execute',
      name: 'qa',
      signature: 'question:string -> answer:string',
      options: { id: 'qa', reads: ['question'], writes: ['qaResult'] },
    },
  ],
  component_map: {
    'root.flow.missing::qa::instruction': 'Nope.',
  },
  expected_error_contains: 'unknown optimized component id',
});

writeFixture('flow-evaluate-rollback', {
  kind: 'optimize',
  operation: 'evaluate',
  program: 'flow',
  program_id: 'root.flow',
  signature: 'question:string -> answer:string',
  steps: [
    {
      kind: 'execute',
      name: 'qa',
      signature: 'question:string -> answer:string',
      options: {
        id: 'qa',
        instruction: 'Base flow instruction.',
        reads: ['question'],
        writes: ['qaResult'],
      },
    },
  ],
  returns: { answer: 'answer' },
  candidate_map: {
    'root.flow.qa::qa::instruction': 'Temporary optimized flow prompt.',
  },
  dataset: [
    {
      input: { question: 'Capital of France?' },
      expectedOutput: { answer: 'Paris' },
      score: 1,
    },
  ],
  responses: [{ content: '{"answer":"Paris"}' }],
  expected_evaluation_subset: {
    avg: 1,
    count: 1,
    candidateMap: {
      'root.flow.qa::qa::instruction': 'Temporary optimized flow prompt.',
    },
  },
  expected_evaluation_rows_subset: [
    {
      prediction: {
        completionType: 'final',
        output: { answer: 'Paris' },
      },
      scalar: 1,
    },
  ],
  expected_components_subset_after: [
    {
      id: 'root.flow.qa::qa::instruction',
      current: 'Base flow instruction.',
    },
  ],
});

writeFixture('flow-engine-evaluator-rollout', {
  kind: 'optimize',
  operation: 'engine',
  program: 'flow',
  program_id: 'root.flow',
  signature: 'question:string -> answer:string',
  steps: [
    {
      kind: 'execute',
      name: 'qa',
      signature: 'question:string -> answer:string',
      options: {
        id: 'qa',
        instruction: 'Base flow instruction.',
        reads: ['question'],
        writes: ['qaResult'],
      },
    },
  ],
  returns: { answer: 'answer' },
  dataset: [
    {
      input: { question: 'Capital of France?' },
      expectedOutput: { answer: 'Paris' },
      score: 1,
    },
  ],
  responses: [{ content: '{"answer":"Paris"}' }],
  engine_uses_evaluator: true,
  optimize_options: { target: 'all' },
  engine_response: {
    evaluate: [
      {
        component_map: {
          'root.flow.qa::qa::instruction': 'Use flow optimizer evidence.',
        },
      },
    ],
    componentMap: {
      'root.flow.qa::qa::instruction': 'Use flow optimizer evidence.',
    },
  },
  expected_engine_request_subset: {
    contractVersion: 'axir-optimize-contract-v1',
    programKind: 'axflow',
    evaluator: {
      available: true,
      contractVersion: 'axir-optimizer-evaluator-v1',
    },
  },
  expected_engine_evaluations_subset: [
    {
      avg: 1,
      count: 1,
      candidateMap: {
        'root.flow.qa::qa::instruction': 'Use flow optimizer evidence.',
      },
    },
  ],
  expected_artifact_subset: {
    artifactVersion: 'axir-optimized-artifact-v1',
    changedComponents: [
      {
        id: 'root.flow.qa::qa::instruction',
        current: 'Base flow instruction.',
        next: 'Use flow optimizer evidence.',
      },
    ],
    componentMap: {
      'root.flow.qa::qa::instruction': 'Use flow optimizer evidence.',
    },
  },
  expected_components_subset: [
    {
      id: 'root.flow.qa::qa::instruction',
      current: 'Use flow optimizer evidence.',
    },
  ],
});
