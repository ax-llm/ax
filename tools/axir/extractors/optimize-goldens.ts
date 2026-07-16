import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  adjustEvalScoreForActions,
  buildAgentJudgeCriteria,
  mapAgentJudgeQualityToScore,
  normalizeAgentEvalDataset,
  resolveAgentOptimizeTargetIds,
} from '../../../src/ax/agent/optimize.js';
import { AxACE } from '../../../src/ax/dsp/optimizers/ace.js';
import {
  applyCuratorOperations,
  createEmptyPlaybook,
  dedupePlaybookByContent,
  renderPlaybook,
  updateBulletFeedback,
} from '../../../src/ax/dsp/optimizers/acePlaybook.js';
import type {
  AxACECuratorOperation,
  AxACEPlaybook,
  AxACEReflectionOutput,
} from '../../../src/ax/dsp/optimizers/aceTypes.js';
import { getGEPAUpdateGroup } from '../../../src/ax/dsp/optimizers/gepaDependencies.js';
import { scalarizeGEPAScores } from '../../../src/ax/dsp/optimizers/gepaEvaluation.js';
import { summarizeGEPATraces } from '../../../src/ax/dsp/optimizers/gepaReflection.js';
import { AxGEPAComponentSelector } from '../../../src/ax/dsp/optimizers/gepaSelection.js';
import {
  buildParetoFront,
  hypervolume2D,
} from '../../../src/ax/dsp/optimizers/paretoUtils.js';
import { AxSignature, f } from '../../../src/ax/dsp/sig.js';
import { ax } from '../../../src/ax/dsp/template.js';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Fixture = Record<string, Json>;

const outRoot = process.env.AXIR_CONFORMANCE_OUT_ROOT ?? process.cwd();
const outDir = join(outRoot, 'ir/conformance/axoptimize');

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
      parentKey === 'engine_response' ||
      parentKey === 'sections'
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

// The deterministic ACE playbook helpers stamp `new Date().toISOString()` onto
// bullets and playbook metadata. The lowered AxIR ops instead take an explicit
// `now` input so the conformance fixtures stay reproducible. Freeze the clock to
// a fixed ISO timestamp around the TS calls so the TS-derived golden matches the
// value the lowered op produces when given the same `now`.
function withFrozenClock<T>(now: string, fn: () => T): T {
  const RealDate = Date;
  const fixedMs = RealDate.parse(now);
  class FrozenDate extends RealDate {
    constructor(...args: any[]) {
      super(...(args.length === 0 ? [fixedMs] : args));
    }
    static now(): number {
      return fixedMs;
    }
  }
  (globalThis as { Date: DateConstructor }).Date =
    FrozenDate as unknown as DateConstructor;
  try {
    return fn();
  } finally {
    (globalThis as { Date: DateConstructor }).Date = RealDate;
  }
}

const ACE_NOW = '2024-01-02T03:04:05.000Z';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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
  scalarizeGEPAScores({ faithfulness: 0.7, helpfulness: 0.9 });
  const targets = [
    {
      id: 'qa::instruction',
      kind: 'instruction',
      current: 'answer',
      owner: 'qa',
    },
    {
      id: 'qa::rubric',
      kind: 'instruction',
      current: 'be precise',
      owner: 'qa',
      dependsOn: ['qa::instruction'],
    },
  ];
  const selector = new AxGEPAComponentSelector(targets);
  selector.recordProposal('qa::instruction');
  selector.recordResult('qa::instruction', true, 0);
  selector.pick(1, () => 0.5);
  selector.snapshot();
  getGEPAUpdateGroup(targets[1]!, targets);
  summarizeGEPATraces([
    {
      score: 0.7,
      calls: [
        {
          componentId: 'search',
          fn: 'search',
          ok: true,
          ms: 5,
          args: { query: 'x' },
          result: { ok: true },
        },
      ],
      output: { answer: 'yes' },
    },
  ]);
  buildParetoFront([
    { idx: 0, scores: { faithfulness: 0.8, helpfulness: 0.6 } },
    { idx: 1, scores: { faithfulness: 0.7, helpfulness: 0.9 } },
  ]);
  hypervolume2D([
    { faithfulness: 0.8, helpfulness: 0.6 },
    { faithfulness: 0.7, helpfulness: 0.9 },
  ]);
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

const gepaComponents = [
  {
    constraints: 'Keep the word answer in the instruction.',
    current: 'Base answer instruction',
    description: 'Primary prompt instruction.',
    id: 'qa::instruction',
    kind: 'instruction',
    owner: 'qa',
    preserve: ['answer'],
  },
  {
    current: 'base_style',
    dependsOn: ['qa::instruction'],
    description: 'Naming style primitive.',
    format: 'snake_case',
    id: 'qa::style',
    kind: 'instruction',
    owner: 'qa',
  },
];

const selectorTargets = gepaComponents.map((component) => ({
  current: component.current,
  dependsOn: component.dependsOn,
  id: component.id,
  kind: component.kind,
  owner: component.owner,
}));
const selector = new AxGEPAComponentSelector(selectorTargets);
selector.recordProposal('qa::instruction');
selector.recordResult('qa::instruction', true, 0);
selector.recordProposal('qa::style');
selector.recordResult('qa::style', false, 1);
const selectorSnapshot = selector.snapshot();
const _gepaPareto = buildParetoFront(
  [
    { idx: 0, scores: { faithfulness: 0.6, helpfulness: 0.7 } },
    { idx: 1, scores: { faithfulness: 0.8, helpfulness: 0.8 } },
    { idx: 2, scores: { faithfulness: 0.9, helpfulness: 0.4 } },
  ],
  0
);
const gepaTraceSummary = summarizeGEPATraces(
  [
    {
      calls: [
        {
          args: { query: 'What changed in the prompt?' },
          componentId: 'qa::instruction',
          fn: 'search_docs',
          ms: 12,
          ok: true,
          result: {
            body: 'Reflection improved the instruction.',
            title: 'GEPA notes',
          },
        },
      ],
      output: { answer: 'Improved.' },
      score: 0.82,
    },
  ],
  { maxRows: 1, maxValueChars: 80 }
);

writeFixture('gepa-max-metric-calls-error', {
  kind: 'optimize',
  operation: 'gepa',
  program: 'axgen',
  components: [gepaComponents[0]],
  dataset: [
    { input: { question: 'One?' }, score: 1 },
    { input: { question: 'Two?' }, score: 1 },
  ],
  optimize_options: { maxMetricCalls: 1, numTrials: 0 },
  gepa_scores: { 'Base answer instruction': 0.5 },
  expected_error_contains:
    'AxGEPA: options.maxMetricCalls=1 is too small to evaluate the initial Pareto set',
});

writeFixture('gepa-selector-state-artifact', {
  kind: 'optimize',
  operation: 'gepa',
  program: 'axgen',
  components: gepaComponents,
  dataset: [{ input: { question: 'Capital?' }, score: 1 }],
  optimize_options: {
    maxMetricCalls: 2,
    numTrials: 0,
    paretoSetSize: 2,
    selectorState: selectorSnapshot,
  },
  gepa_scores: {
    'Base answer instruction': { faithfulness: 0.6, helpfulness: 0.7 },
    base_style: { faithfulness: 0.3, helpfulness: 0.4 },
  },
  score_options: { paretoMetricKey: 'faithfulness' },
  expected_artifact_subset: {
    artifactVersion: 'axir-optimized-artifact-v1',
    componentMap: {
      'qa::instruction': 'Base answer instruction',
      'qa::style': 'base_style',
    },
    metadata: {
      optimizer: 'GEPA',
      report: {
        summary: 'GEPA Multi-Objective Optimization Complete',
      },
      selectorState: selectorSnapshot,
    },
    optimizerName: 'GEPA',
    optimizerVersion: 'axir-gepa-v1',
    provenance: {
      sourceProgramKind: 'axgen',
    },
  },
  expected_gepa_evaluations_subset: [
    {
      avg: scalarizeGEPAScores({ faithfulness: 0.6, helpfulness: 0.7 }, {
        paretoMetricKey: 'faithfulness',
      } as any),
      count: 1,
      phase: 'initial Pareto evaluation',
    },
  ],
});

writeFixture('gepa-reflection-validation-retry', {
  kind: 'optimize',
  operation: 'gepa',
  program: 'axgen',
  components: [gepaComponents[0]],
  dataset: [{ input: { question: 'Capital?' }, score: 1 }],
  optimize_options: {
    maxMetricCalls: 6,
    minibatchSize: 1,
    numTrials: 1,
    seed: 7,
  },
  reflection_responses: [
    { results: [{ content: 'New Value: cite sources clearly', index: 0 }] },
    { results: [{ content: 'New Value: answer with citations', index: 0 }] },
  ],
  gepa_scores: {
    'Base answer instruction': 0.2,
    'answer with citations': 0.9,
  },
  expected_artifact_subset: {
    componentMap: {
      'qa::instruction': 'answer with citations',
    },
    metadata: {
      bestScore: 0.9,
      candidatesExplored: 2,
    },
    optimizerName: 'GEPA',
  },
});

writeFixture('gepa-tie-prefers-later-accepted', {
  kind: 'optimize',
  operation: 'gepa',
  program: 'axgen',
  components: [gepaComponents[0]],
  dataset: {
    train: [{ input: { question: 'Train tie breaker?' }, score: 1 }],
    validation: [
      { input: { question: 'Validation one?' }, score: 1 },
      { input: { question: 'Validation two?' }, score: 1 },
    ],
  },
  optimize_options: {
    maxMetricCalls: 6,
    minibatchSize: 1,
    numTrials: 1,
    seed: 7,
  },
  reflection_responses: [
    {
      results: [{ content: 'New Value: answer accepted tie later', index: 0 }],
    },
  ],
  gepa_scores: {
    'Base answer instruction': [0.5, 0.5],
    'answer accepted tie later': [0.75, 0.25],
  },
  expected_artifact_subset: {
    componentMap: {
      'qa::instruction': 'answer accepted tie later',
    },
    metadata: {
      bestScore: 0.5,
      candidatesExplored: 2,
    },
    optimizerName: 'GEPA',
  },
});

writeFixture('gepa-bootstrap-demos', {
  kind: 'optimize',
  operation: 'gepa',
  program: 'axgen',
  components: [gepaComponents[0]],
  dataset: [{ input: { question: 'Keep?' }, score: 1 }],
  optimize_options: {
    bootstrap: {
      maxBootstrapDemos: 1,
      maxBootstrapMetricCalls: 1,
      scoreThreshold: 0.8,
    },
    maxMetricCalls: 3,
    numTrials: 0,
  },
  gepa_scores: {
    'Base answer instruction': 0.95,
  },
  expected_artifact_subset: {
    demos: [
      {
        programId: 'root',
        traces: [
          {
            actionLog: [],
            completionType: 'final',
            finalOutput: {
              componentValue: 'Base answer instruction',
            },
            functionCalls: [],
            output: {
              componentValue: 'Base answer instruction',
            },
            trace: {
              componentValue: 'Base answer instruction',
            },
            usage: {},
          },
        ],
      },
    ],
    metadata: {
      totalMetricCalls: 2,
    },
  },
});

const optimizeHelperResponses = Array.from({ length: 24 }, () => ({
  content: '{"answer":"ok"}',
}));

writeFixture('bootstrap-quality-threshold', {
  kind: 'optimize',
  operation: 'bootstrap',
  program: 'axgen',
  components: [gepaComponents[0]],
  dataset: [
    { input: { question: 'Accept?' }, score: 0.75 },
    { input: { question: 'Reject?' }, score: 0.25 },
  ],
  optimize_options: {
    batchSize: 1,
    maxDemos: 4,
    maxExamples: 2,
    maxRounds: 1,
    qualityThreshold: 0.7,
  },
  expected_demo_count: 1,
  expected_artifact_subset: {
    artifactVersion: 'axir-optimized-artifact-v1',
    metadata: {
      qualityThreshold: 0.7,
    },
    optimizerName: 'BootstrapFewShot',
    optimizerVersion: 'axir-bootstrap-fewshot-v1',
  },
});

writeFixture('optimize-helper-small-default-bootstrap', {
  kind: 'optimize',
  operation: 'helper',
  program: 'axgen',
  signature: 'question:string -> answer:string',
  dataset: [
    { input: { question: 'One?' }, score: 1 },
    { input: { question: 'Two?' }, score: 1 },
  ],
  responses: optimizeHelperResponses,
  optimize_options: {
    maxMetricCalls: 100,
    numTrials: 0,
  },
  expected_demo_count: 2,
  expected_artifact_subset: {
    artifactVersion: 'axir-optimized-artifact-v1',
  },
  expected_components_subset: [
    {
      current: '',
      id: 'root::instruction',
    },
  ],
});

writeFixture('optimize-helper-large-skips-bootstrap', {
  kind: 'optimize',
  operation: 'helper',
  program: 'axgen',
  signature: 'question:string -> answer:string',
  dataset: Array.from({ length: 9 }, (_, index) => ({
    input: { question: `Question ${index}?` },
    score: 1,
  })),
  responses: optimizeHelperResponses,
  optimize_options: {
    maxMetricCalls: 100,
    numTrials: 0,
  },
  expected_demo_count: 0,
  expected_artifact_subset: {
    artifactVersion: 'axir-optimized-artifact-v1',
  },
});

writeFixture('optimize-helper-bootstrap-false', {
  kind: 'optimize',
  operation: 'helper',
  program: 'axgen',
  signature: 'question:string -> answer:string',
  dataset: [{ input: { question: 'Skip demos?' }, score: 1 }],
  responses: optimizeHelperResponses,
  optimize_options: {
    bootstrap: false,
    maxMetricCalls: 100,
    numTrials: 0,
  },
  expected_demo_count: 0,
  expected_artifact_subset: {
    artifactVersion: 'axir-optimized-artifact-v1',
  },
  expected_components_subset: [
    {
      current: '',
      id: 'root::instruction',
    },
  ],
});

writeFixture('optimize-helper-bootstrap-options', {
  kind: 'optimize',
  operation: 'helper',
  program: 'axgen',
  signature: 'question:string -> answer:string',
  dataset: [
    { input: { question: 'Too low?' }, score: 0.4 },
    { input: { question: 'High enough?' }, score: 0.9 },
  ],
  responses: optimizeHelperResponses,
  optimize_options: {
    bootstrap: {
      maxDemos: 1,
      qualityThreshold: 0.8,
    },
    maxMetricCalls: 100,
    numTrials: 0,
  },
  expected_demo_count: 1,
  expected_artifact_subset: {
    artifactVersion: 'axir-optimized-artifact-v1',
  },
});

writeFixture('gepa-descendant-component-optimization', {
  kind: 'optimize',
  operation: 'gepa',
  program: 'axgen',
  components: gepaComponents,
  dataset: [{ input: { question: 'Name style?' }, score: 1 }],
  optimize_options: {
    maxMetricCalls: 8,
    minibatchSize: 1,
    numTrials: 1,
    seed: 123,
  },
  reflection_responses: [
    { results: [{ content: 'New Value: improved_style', index: 0 }] },
    {
      results: [
        { content: 'New Value: answer dependency instruction', index: 0 },
      ],
    },
  ],
  gepa_scores: {
    'Base answer instruction': 0.2,
    'answer dependency instruction': 0.85,
    improved_style: 0.85,
  },
  expected_artifact_subset: {
    metadata: {
      optimizer: 'GEPA',
    },
    optimizerName: 'GEPA',
    provenance: {
      componentOwners: {
        'qa::instruction': 'qa',
        'qa::style': 'qa',
      },
    },
  },
});

writeFixture('gepa-ts-helper-contract', {
  kind: 'optimize',
  operation: 'evidence',
  components: gepaComponents,
  eval_result: {
    avg: scalarizeGEPAScores({ faithfulness: 0.8, helpfulness: 0.8 }),
    candidateMap: {
      'qa::instruction': 'answer with citations',
    },
    count: 1,
    rows: [
      {
        input: { question: 'Trace?' },
        prediction: { completionType: 'final', output: { answer: 'Done.' } },
        scalar: scalarizeGEPAScores({ faithfulness: 0.8, helpfulness: 0.8 }),
        scores: { faithfulness: 0.8, helpfulness: 0.8 },
        trace: {
          gepaTraceSummary,
          updateGroup: getGEPAUpdateGroup(
            selectorTargets[1]!,
            selectorTargets
          ).map((item) => item.id),
        },
      },
    ],
    sum: scalarizeGEPAScores({ faithfulness: 0.8, helpfulness: 0.8 }),
  },
  expected_evidence_subset: {
    reflectiveDataset: {
      'qa::instruction': [
        {
          output: {
            answer: 'Done.',
          },
          score: scalarizeGEPAScores({ faithfulness: 0.8, helpfulness: 0.8 }),
          trace: {
            gepaTraceSummary,
            updateGroup: ['qa::style', 'qa::instruction'],
          },
        },
      ],
      'qa::style': [
        {
          output: {
            answer: 'Done.',
          },
          score: scalarizeGEPAScores({ faithfulness: 0.8, helpfulness: 0.8 }),
          trace: {
            gepaTraceSummary,
            updateGroup: ['qa::style', 'qa::instruction'],
          },
        },
      ],
    },
    contractVersion: 'axir-optimizer-evidence-v1',
    scoreVectors: [{ faithfulness: 0.8, helpfulness: 0.8 }],
  },
});

writeFixture('agent-component-inventory', {
  kind: 'optimize',
  operation: 'components',
  program: 'agent',
  signature: 'question:string -> answer:string',
  expected_components_subset: [
    { id: 'task.root.responder::instruction', kind: 'instruction' },
    { id: 'root::instruction', kind: 'instruction', owner: 'root' },
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
  expected_component_ids: ['root::instruction'],
});

writeFixture('agent-stage-instruction-apply', {
  kind: 'optimize',
  operation: 'apply',
  program: 'agent',
  signature: 'question:string -> answer:string',
  component_map: {
    'root::instruction': 'Verify every claim before finalizing.',
  },
  expected_components_subset: [
    {
      id: 'root::instruction',
      kind: 'instruction',
      current: 'Verify every claim before finalizing.',
    },
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

writeFixture('artifact-provenance-roundtrip', {
  kind: 'optimize',
  operation: 'artifact',
  program: 'agent',
  signature: 'question:string -> answer:string',
  component_map: {
    'task.root.responder::instruction': 'Respond with artifact provenance.',
  },
  metadata: {
    evidence: {
      avg: 1,
      count: 1,
    },
    provenance: {
      componentOwners: {
        'task.root.responder::instruction': 'task.root.responder',
      },
      datasetHash: 'fixture-dataset-hash',
      sourceProgramKind: 'axagent',
    },
  },
  expected_artifact_subset: {
    artifactVersion: 'axir-optimized-artifact-v1',
    componentMap: {
      'task.root.responder::instruction': 'Respond with artifact provenance.',
    },
    evidence: {
      avg: 1,
      count: 1,
    },
    provenance: {
      componentOwners: {
        'task.root.responder::instruction': 'task.root.responder',
      },
      datasetHash: 'fixture-dataset-hash',
      sourceProgramKind: 'axagent',
    },
  },
});

writeFixture('artifact-stale-owner-rejected', {
  kind: 'optimize',
  operation: 'artifact',
  program: 'agent',
  signature: 'question:string -> answer:string',
  component_map: {
    'task.root.responder::instruction': 'This should not apply.',
  },
  metadata: {
    provenance: {
      componentOwners: {
        'task.root.responder::instruction': 'old.responder.owner',
      },
    },
  },
  expected_error_contains: 'stale optimized component owner',
});

writeFixture('artifact-invalid-component-value-rejected', {
  kind: 'optimize',
  operation: 'artifact',
  program: 'agent',
  signature: 'question:string -> answer:string',
  component_map: {
    'task.root.responder::instruction': {
      invalid: true,
    },
  },
  expected_error_contains: 'invalid optimized component value',
});

writeFixture('artifact-serialized-apply-axgen', {
  kind: 'optimize',
  operation: 'apply',
  program: 'axgen',
  signature: 'query:string -> answer:string',
  options: { id: 'qa', instruction: 'Answer succinctly.' },
  serialized_artifact: true,
  component_map: {
    'qa::instruction': 'Apply from serialized artifact.',
  },
  metadata: {
    evidence: { avg: 1 },
    provenance: { sourceProgramKind: 'axgen' },
  },
  expected_components_subset: [
    {
      current: 'Apply from serialized artifact.',
      id: 'qa::instruction',
    },
  ],
});

writeFixture('artifact-serialized-apply-agent', {
  kind: 'optimize',
  operation: 'apply',
  program: 'agent',
  signature: 'question:string -> answer:string',
  serialized_artifact: true,
  component_map: {
    'task.root.responder::instruction': 'Apply agent artifact later.',
  },
  metadata: {
    evidence: { avg: 0.9 },
    provenance: { sourceProgramKind: 'axagent' },
  },
  expected_components_subset: [
    {
      current: 'Apply agent artifact later.',
      id: 'task.root.responder::instruction',
    },
  ],
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

writeFixture('scripted-engine-apply', {
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
    optimizerName: 'scripted',
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

writeFixture('engine-reference-evaluator-transcript', {
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
    referenceCandidates: [
      {
        componentMap: {
          'task.root.responder::instruction': 'First candidate wins ties.',
        },
      },
      {
        componentMap: {
          'task.root.responder::instruction': 'Second candidate loses tie.',
        },
      },
    ],
  },
  expected_engine_request_subset: {
    contractVersion: 'axir-optimize-contract-v1',
    evaluator: {
      available: true,
      contractVersion: 'axir-optimizer-evaluator-v1',
      evidenceContractVersion: 'axir-optimizer-evidence-v1',
    },
  },
  expected_engine_evaluations_subset: [
    {
      avg: 1,
      count: 1,
      candidateMap: {
        'task.root.responder::instruction': 'First candidate wins ties.',
      },
    },
    {
      avg: 1,
      count: 1,
      candidateMap: {
        'task.root.responder::instruction': 'Second candidate loses tie.',
      },
    },
  ],
  expected_engine_transcripts_subset: [
    {
      candidateMap: {
        'task.root.responder::instruction': 'First candidate wins ties.',
      },
      evidence: {
        contractVersion: 'axir-optimizer-evidence-v1',
        count: 1,
        scores: [1],
      },
    },
    {
      candidateMap: {
        'task.root.responder::instruction': 'Second candidate loses tie.',
      },
      evidence: {
        contractVersion: 'axir-optimizer-evidence-v1',
        count: 1,
        scores: [1],
      },
    },
  ],
  expected_artifact_subset: {
    artifactVersion: 'axir-optimized-artifact-v1',
    componentMap: {
      'task.root.responder::instruction': 'First candidate wins ties.',
    },
    metadata: {
      referenceEngine: true,
    },
  },
  expected_components_subset: [
    {
      current: 'First candidate wins ties.',
      id: 'task.root.responder::instruction',
    },
  ],
});

writeFixture('engine-invalid-artifact-version', {
  kind: 'optimize',
  operation: 'engine',
  program: 'agent',
  signature: 'question:string -> answer:string',
  dataset: [{ input: { question: 'Capital?' }, score: 1 }],
  engine_response: {
    artifactVersion: 'axir-optimized-artifact-v0',
    componentMap: {},
  },
  expected_error_contains: 'unsupported optimized artifact version',
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

writeFixture('gepa-compatible-evidence-batch', {
  kind: 'optimize',
  operation: 'evidence',
  components: [
    {
      id: 'qa::instruction',
      kind: 'instruction',
      owner: 'qa',
    },
    {
      id: 'qa::fn:search_docs:desc',
      kind: 'fn-desc',
      owner: 'qa',
    },
  ],
  eval_result: {
    avg: scalarizeGEPAScores({ faithfulness: 0.8, helpfulness: 0.6 }),
    candidateMap: {
      'qa::instruction': 'Use evidence from retrieved docs.',
    },
    count: 1,
    rows: [
      {
        input: { question: 'Capital?' },
        prediction: {
          completionType: 'final',
          functionCalls: [
            {
              componentId: 'search_docs',
              name: 'search_docs',
              qualifiedName: 'tools.search_docs',
            },
          ],
          output: { answer: 'Paris' },
        },
        scalar: scalarizeGEPAScores({ faithfulness: 0.8, helpfulness: 0.6 }),
        scores: { faithfulness: 0.8, helpfulness: 0.6 },
        trace: {
          calls: [
            {
              componentId: 'search_docs',
              name: 'search_docs',
              qualifiedName: 'tools.search_docs',
            },
          ],
        },
      },
    ],
    sum: scalarizeGEPAScores({ faithfulness: 0.8, helpfulness: 0.6 }),
  },
  expected_evidence_subset: {
    contractVersion: 'axir-optimizer-evidence-v1',
    candidateMap: {
      'qa::instruction': 'Use evidence from retrieved docs.',
    },
    outputs: [{ answer: 'Paris' }],
    scores: [scalarizeGEPAScores({ faithfulness: 0.8, helpfulness: 0.6 })],
    scoreVectors: [{ faithfulness: 0.8, helpfulness: 0.6 }],
    reflectiveDataset: {
      'qa::instruction': [
        {
          output: { answer: 'Paris' },
          score: scalarizeGEPAScores({ faithfulness: 0.8, helpfulness: 0.6 }),
          trace: {
            calls: [
              {
                componentId: 'search_docs',
                name: 'search_docs',
                qualifiedName: 'tools.search_docs',
              },
            ],
          },
        },
      ],
    },
  },
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

writeFixture('artifact-serialized-apply-flow', {
  kind: 'optimize',
  operation: 'apply',
  program: 'flow',
  program_id: 'root.flow',
  signature: 'question:string -> answer:string',
  serialized_artifact: true,
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
    'root.flow.qa::qa::instruction': 'Apply serialized flow artifact.',
  },
  metadata: {
    evidence: { avg: 1 },
    provenance: { sourceProgramKind: 'axflow' },
  },
  expected_components_subset: [
    {
      id: 'root.flow.qa::qa::instruction',
      current: 'Apply serialized flow artifact.',
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

// --- ACE playbook deterministic helper fixtures -----------------------------
// These exercise the lowered `@ace_*` ops authored in ir/axcore/optimize.axir.
// All timestamps are explicit so the lowered ops (which take an explicit `now`)
// reproduce the TS-derived goldens exactly; ADD operations always carry an
// explicit bulletId so no nondeterministic id is invented.

function aceBullet(
  id: string,
  section: string,
  content: string,
  overrides: Partial<{
    helpfulCount: number;
    harmfulCount: number;
    createdAt: string;
    updatedAt: string;
    metadata: Record<string, unknown>;
  }> = {}
): Record<string, Json> {
  const bullet: Record<string, Json> = {
    id,
    section,
    content,
    helpfulCount: overrides.helpfulCount ?? 0,
    harmfulCount: overrides.harmfulCount ?? 0,
    createdAt: overrides.createdAt ?? '2023-12-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2023-12-01T00:00:00.000Z',
  };
  if (overrides.metadata) bullet.metadata = overrides.metadata as Json;
  return bullet;
}

function acePlaybook(
  sections: Record<string, Record<string, Json>[]>,
  options: { description?: string; updatedAt?: string } = {}
): AxACEPlaybook {
  let bulletCount = 0;
  let helpfulCount = 0;
  let harmfulCount = 0;
  let tokenEstimate = 0;
  for (const bullets of Object.values(sections)) {
    for (const bullet of bullets) {
      bulletCount += 1;
      helpfulCount += Number(bullet.helpfulCount ?? 0);
      harmfulCount += Number(bullet.harmfulCount ?? 0);
      tokenEstimate += Math.ceil(String(bullet.content ?? '').length / 4);
    }
  }
  const playbook: Record<string, Json> = {
    version: 1,
    sections: sections as unknown as Json,
    stats: { bulletCount, helpfulCount, harmfulCount, tokenEstimate },
    updatedAt: options.updatedAt ?? '2023-12-01T00:00:00.000Z',
  };
  if (options.description !== undefined)
    playbook.description = options.description;
  return playbook as unknown as AxACEPlaybook;
}

// playbook-empty: createEmptyPlaybook(description?, now)
const emptyWithDescription = withFrozenClock(ACE_NOW, () =>
  createEmptyPlaybook('Grounded answers only.')
);
writeFixture('ace-empty-with-description', {
  kind: 'optimize',
  operation: 'playbook-empty',
  description: 'Grounded answers only.',
  now: ACE_NOW,
  expected_playbook: emptyWithDescription as unknown as Json,
});

const emptyNoDescription = withFrozenClock(ACE_NOW, () =>
  createEmptyPlaybook()
);
writeFixture('ace-empty-no-description', {
  kind: 'optimize',
  operation: 'playbook-empty',
  now: ACE_NOW,
  expected_playbook: emptyNoDescription as unknown as Json,
});

// playbook-render: with description, multiple sections and an empty section.
const renderPlaybookInput = acePlaybook(
  {
    strategies: [
      aceBullet('calc-00001', 'strategies', 'Break the problem into steps.'),
      aceBullet('calc-00002', 'strategies', 'Verify the final arithmetic.'),
    ],
    pitfalls: [aceBullet('calc-00003', 'pitfalls', 'Do not skip unit checks.')],
    scratch: [],
  },
  { description: '  Reusable tactics for math word problems.  ' }
);
writeFixture('ace-render-with-description', {
  kind: 'optimize',
  operation: 'playbook-render',
  playbook: clone(renderPlaybookInput) as unknown as Json,
  expected_render: renderPlaybook(renderPlaybookInput),
});

// playbook-render: no description, single empty section.
const renderEmptySection = acePlaybook({ strategies: [] });
writeFixture('ace-render-no-description-empty-section', {
  kind: 'optimize',
  operation: 'playbook-render',
  playbook: clone(renderEmptySection) as unknown as Json,
  expected_render: renderPlaybook(renderEmptySection),
});

// Empty-string descriptions are falsy in the TS renderer and therefore behave
// exactly like an absent description when the playbook has no bullets.
const renderEmptyDescription = acePlaybook(
  { strategies: [] },
  { description: '' }
);
writeFixture('ace-render-empty-description-empty-section', {
  kind: 'optimize',
  operation: 'playbook-render',
  playbook: clone(renderEmptyDescription) as unknown as Json,
  expected_render: renderPlaybook(renderEmptyDescription),
});

// playbook-stats: recompute stats over a (duplicate-free) playbook. The TS
// recomputePlaybookStats is internal, so derive the golden via the exported
// dedupe path (which recomputes stats and leaves a dup-free playbook intact).
const statsInput = acePlaybook({
  strategies: [
    aceBullet('calc-00001', 'strategies', 'Outline the approach first.', {
      helpfulCount: 3,
      harmfulCount: 1,
    }),
    aceBullet(
      'calc-00002',
      'strategies',
      'Double-check edge cases carefully.',
      {
        helpfulCount: 2,
      }
    ),
  ],
  pitfalls: [
    aceBullet('calc-00003', 'pitfalls', 'Avoid off-by-one mistakes.', {
      harmfulCount: 2,
    }),
  ],
});
// Corrupt the stored stats so the recompute is observable.
(statsInput.stats as Record<string, number>).bulletCount = 0;
(statsInput.stats as Record<string, number>).helpfulCount = 0;
(statsInput.stats as Record<string, number>).harmfulCount = 0;
(statsInput.stats as Record<string, number>).tokenEstimate = 0;
const statsExpected = clone(statsInput);
dedupePlaybookByContent(statsExpected as unknown as AxACEPlaybook);
writeFixture('ace-recompute-stats', {
  kind: 'optimize',
  operation: 'playbook-stats',
  playbook: clone(statsInput) as unknown as Json,
  expected_playbook: statsExpected as unknown as Json,
});

// playbook-dedupe: exact normalized-content duplicates are merged (counters
// summed, latest updatedAt kept) and stats recomputed.
const dedupeInput = acePlaybook({
  strategies: [
    aceBullet('calc-00001', 'strategies', 'Re-read the prompt.', {
      helpfulCount: 1,
      updatedAt: '2023-12-02T00:00:00.000Z',
    }),
    aceBullet('calc-00002', 'strategies', '  re-read THE prompt.  ', {
      helpfulCount: 2,
      harmfulCount: 1,
      updatedAt: '2023-12-05T00:00:00.000Z',
    }),
    aceBullet('calc-00003', 'strategies', 'State assumptions.', {
      helpfulCount: 4,
    }),
  ],
});
const dedupeExpected = clone(dedupeInput);
dedupePlaybookByContent(dedupeExpected as unknown as AxACEPlaybook);
writeFixture('ace-dedupe-merges-duplicates', {
  kind: 'optimize',
  operation: 'playbook-dedupe',
  playbook: clone(dedupeInput) as unknown as Json,
  expected_playbook: dedupeExpected as unknown as Json,
});

// playbook-feedback: increment helpful then harmful counters by id.
const feedbackHelpfulInput = acePlaybook({
  strategies: [
    aceBullet('calc-00001', 'strategies', 'Show intermediate work.', {
      helpfulCount: 1,
    }),
    aceBullet('calc-00002', 'strategies', 'Restate the goal.'),
  ],
});
const feedbackHelpfulExpected = clone(feedbackHelpfulInput);
withFrozenClock(ACE_NOW, () =>
  updateBulletFeedback(
    feedbackHelpfulExpected as unknown as AxACEPlaybook,
    'calc-00001',
    'helpful'
  )
);
writeFixture('ace-feedback-helpful', {
  kind: 'optimize',
  operation: 'playbook-feedback',
  playbook: clone(feedbackHelpfulInput) as unknown as Json,
  bullet_id: 'calc-00001',
  tag: 'helpful',
  now: ACE_NOW,
  expected_playbook: feedbackHelpfulExpected as unknown as Json,
});

const feedbackHarmfulInput = acePlaybook({
  pitfalls: [
    aceBullet('calc-00010', 'pitfalls', 'Stop guessing without evidence.', {
      harmfulCount: 1,
    }),
  ],
});
const feedbackHarmfulExpected = clone(feedbackHarmfulInput);
withFrozenClock(ACE_NOW, () =>
  updateBulletFeedback(
    feedbackHarmfulExpected as unknown as AxACEPlaybook,
    'calc-00010',
    'harmful'
  )
);
writeFixture('ace-feedback-harmful', {
  kind: 'optimize',
  operation: 'playbook-feedback',
  playbook: clone(feedbackHarmfulInput) as unknown as Json,
  bullet_id: 'calc-00010',
  tag: 'harmful',
  now: ACE_NOW,
  expected_playbook: feedbackHarmfulExpected as unknown as Json,
});

function applyOpsFixture(
  name: string,
  input: AxACEPlaybook,
  operations: AxACECuratorOperation[],
  options: {
    maxSectionSize?: number;
    allowDynamicSections?: boolean;
    enableAutoPrune?: boolean;
    protectedBulletIds?: string[];
  },
  fixtureOptions: Record<string, Json>
): void {
  const mutated = clone(input);
  const result = withFrozenClock(ACE_NOW, () =>
    applyCuratorOperations(mutated as unknown as AxACEPlaybook, operations, {
      maxSectionSize: options.maxSectionSize,
      allowDynamicSections: options.allowDynamicSections,
      enableAutoPrune: options.enableAutoPrune,
      protectedBulletIds: options.protectedBulletIds
        ? new Set(options.protectedBulletIds)
        : undefined,
    })
  );
  writeFixture(name, {
    kind: 'optimize',
    operation: 'playbook-apply-ops',
    playbook: clone(input) as unknown as Json,
    operations: operations as unknown as Json,
    apply_options: fixtureOptions,
    now: ACE_NOW,
    expected_result: {
      playbook: mutated as unknown as Json,
      updatedBulletIds: result.updatedBulletIds as unknown as Json,
      autoRemoved: result.autoRemoved as unknown as Json,
    },
  });
}

// playbook-apply-ops: ADD a new bullet into a new (dynamic) section.
applyOpsFixture(
  'ace-apply-add-new',
  acePlaybook({
    strategies: [aceBullet('calc-00001', 'strategies', 'Plan before solving.')],
  }),
  [
    {
      type: 'ADD',
      section: 'pitfalls',
      bulletId: 'calc-09001',
      content: '  Never ignore the units.  ',
      metadata: { source: 'reflector' },
    },
  ],
  {},
  {}
);

// playbook-apply-ops: ADD that triggers auto-prune at maxSectionSize, with a
// protected bullet that must NOT be pruned.
applyOpsFixture(
  'ace-apply-add-autoprune-protected',
  acePlaybook({
    strategies: [
      aceBullet(
        'keep-protected',
        'strategies',
        'Protected high-value tactic.',
        {
          helpfulCount: 5,
          updatedAt: '2023-12-01T00:00:00.000Z',
        }
      ),
      aceBullet('prune-me', 'strategies', 'Low-value tactic to drop.', {
        helpfulCount: 0,
        harmfulCount: 3,
        updatedAt: '2023-12-03T00:00:00.000Z',
      }),
    ],
  }),
  [
    {
      type: 'ADD',
      section: 'strategies',
      bulletId: 'calc-09002',
      content: 'Fresh tactic to insert.',
    },
  ],
  {
    maxSectionSize: 2,
    enableAutoPrune: true,
    protectedBulletIds: ['keep-protected'],
  },
  {
    maxSectionSize: 2,
    enableAutoPrune: true,
    protectedBulletIds: ['keep-protected'],
  }
);

// playbook-apply-ops: UPDATE by id (content + metadata merge) and REMOVE by id.
applyOpsFixture(
  'ace-apply-update-and-remove',
  acePlaybook({
    strategies: [
      aceBullet('calc-00001', 'strategies', 'Old guidance.', {
        helpfulCount: 2,
        metadata: { origin: 'seed' },
      }),
      aceBullet('calc-00002', 'strategies', 'Remove this one.'),
    ],
  }),
  [
    {
      type: 'UPDATE',
      section: 'strategies',
      bulletId: 'calc-00001',
      content: 'Refined guidance with citations.',
      metadata: { revisedBy: 'curator' },
    },
    { type: 'REMOVE', section: 'strategies', bulletId: 'calc-00002' },
  ],
  {},
  {}
);

// --- ACE engine (compile / online-update) fixtures ---------------------------
// Drive the real TS AxACE engine with scripted generator/metric/reflector/
// curator responses under a frozen clock so the lowered AxACE port reproduces
// the same playbook + artifact deterministically. The port consumes the same
// scripted queues and reuses the `_ace_*` ops, so its output must match these
// TS-derived goldens exactly. Every curator ADD carries an explicit bulletId
// (the deterministic apply op derives ids from the section otherwise).

function makeACEProgram() {
  return ax(
    f().input('question', f.string()).output('answer', f.string()).build()
  );
}

async function withFrozenClockAsync<T>(
  now: string,
  fn: () => Promise<T>
): Promise<T> {
  const RealDate = Date;
  const fixedMs = RealDate.parse(now);
  class FrozenDate extends RealDate {
    constructor(...args: any[]) {
      super(...(args.length === 0 ? [fixedMs] : args));
    }
    static now(): number {
      return fixedMs;
    }
  }
  (globalThis as { Date: DateConstructor }).Date =
    FrozenDate as unknown as DateConstructor;
  try {
    return await fn();
  } finally {
    (globalThis as { Date: DateConstructor }).Date = RealDate;
  }
}

interface ACEScript {
  predictions: unknown[];
  scores: number[];
  reflections: (AxACEReflectionOutput | undefined)[];
  curators: (Record<string, Json> | undefined)[];
}

// The artifact's per-event generatorOutput carries `trajectory` (a JSON-string
// snapshot) and `metadata` (field-name lists) that exist only to build the
// reflector/curator prompts. They are byte-for-byte tied to TS JSON.stringify
// semantics, so the lowered ports intentionally omit them and the goldens strip
// them too; every ACE-state field (playbook, history, feedback scores,
// reflection, curator, example, prediction, timestamp) is still asserted.
function stripGeneratorSerialization(artifact: Json): Json {
  const out = clone(artifact) as {
    feedback?: { generatorOutput?: Record<string, unknown> }[];
  };
  for (const event of out.feedback ?? []) {
    if (event.generatorOutput) {
      delete event.generatorOutput.trajectory;
      delete event.generatorOutput.metadata;
    }
  }
  return out as unknown as Json;
}

function scriptACE(
  ace: AxACE,
  program: { forward: unknown },
  script: ACEScript
): void {
  const predictions = [...script.predictions];
  const reflections = [...script.reflections];
  const curators = [...script.curators];
  program.forward = async () => (predictions.length ? predictions.shift() : {});
  const reflectorProgram = (ace as any).getOrCreateReflectorProgram();
  reflectorProgram.forward = async () =>
    reflections.length ? reflections.shift() : undefined;
  const curatorProgram = (ace as any).getOrCreateCuratorProgram();
  curatorProgram.forward = async () =>
    curators.length ? curators.shift() : undefined;
}

async function driveACECompile(
  examples: Record<string, Json>[],
  aceOptions: Record<string, Json>,
  script: ACEScript
): Promise<{ playbook: Json; artifact: Json }> {
  const program = makeACEProgram();
  const scores = [...script.scores];
  const ace = new AxACE(
    { studentAI: {} as any, teacherAI: {} as any },
    aceOptions as any
  );
  scriptACE(ace, program as unknown as { forward: unknown }, script);
  const metric = async () => (scores.length ? scores.shift()! : 0);
  return withFrozenClockAsync(ACE_NOW, async () => {
    await ace.compile(program, examples as any, metric as any);
    return {
      playbook: ace.getPlaybook() as unknown as Json,
      artifact: stripGeneratorSerialization(
        ace.getArtifact() as unknown as Json
      ),
    };
  });
}

async function driveACEOnlineUpdate(
  initialPlaybook: AxACEPlaybook | undefined,
  update: {
    example: Record<string, Json>;
    prediction: unknown;
    feedback?: string;
  },
  aceOptions: Record<string, Json>,
  script: Omit<ACEScript, 'predictions' | 'scores'>
): Promise<{ playbook: Json; artifact: Json; curator: Json }> {
  const program = makeACEProgram();
  const ace = new AxACE({ studentAI: {} as any, teacherAI: {} as any }, {
    ...aceOptions,
    ...(initialPlaybook ? { initialPlaybook } : {}),
  } as any);
  ace.hydrate(
    program,
    initialPlaybook ? { playbook: initialPlaybook } : undefined
  );
  scriptACE(ace, program as unknown as { forward: unknown }, {
    predictions: [],
    scores: [],
    reflections: script.reflections,
    curators: script.curators,
  });
  return withFrozenClockAsync(ACE_NOW, async () => {
    const curator = await ace.applyOnlineUpdate(update);
    return {
      playbook: ace.getPlaybook() as unknown as Json,
      artifact: stripGeneratorSerialization(
        ace.getArtifact() as unknown as Json
      ),
      curator: (curator ?? null) as unknown as Json,
    };
  });
}

// The real TS AxACE.compile requires >=2 examples (train/validation auto-split),
// so each compile fixture uses two examples; the trailing example is a resolved
// no-op so the asserted playbook reflects only the first example's curation.
const aceResolvedReflection: AxACEReflectionOutput = {
  reasoning: 'Answer already correct.',
  errorIdentification: 'no error',
  rootCauseAnalysis: 'none',
  correctApproach: 'keep going',
  keyInsight: 'stable behavior',
  bulletTags: [],
};
const aceNoopCurator: Record<string, Json> = {
  reasoning: 'Nothing to change.',
  operations: [],
};

await (async () => {
  // ace-compile-add-bullet: first example -> reflector flags an error and the
  // curator ADDs one bullet (explicit id); second example resolves with no op.
  {
    const reflection: AxACEReflectionOutput = {
      reasoning: 'Generator omitted citations.',
      errorIdentification: 'Missing citations in the answer',
      rootCauseAnalysis: 'No instruction to cite sources',
      correctApproach: 'Always cite sources',
      keyInsight: 'Citations build trust',
      bulletTags: [],
    };
    const curator: Record<string, Json> = {
      reasoning: 'Add a citation guideline.',
      operations: [
        {
          type: 'ADD',
          section: 'Guidelines',
          bulletId: 'guidelines-00001',
          content: 'Always cite your sources.',
        },
      ],
    };
    const examples = [
      { question: 'What is the capital of France?', answer: 'Paris' },
      { question: 'ping', answer: 'pong' },
    ];
    const predictions = [{ answer: 'Paris' }, { answer: 'pong' }];
    const scores = [0.5, 1];
    const reflections = [reflection, aceResolvedReflection];
    const curators = [curator, aceNoopCurator];
    const out = await driveACECompile(
      examples,
      { maxEpochs: 1, maxReflectorRounds: 1 },
      { predictions, scores, reflections, curators }
    );
    writeFixture('ace-compile-add-bullet', {
      kind: 'optimize',
      operation: 'ace-compile',
      now: ACE_NOW,
      ace_options: { maxEpochs: 1, maxReflectorRounds: 1 },
      examples,
      generator_predictions: predictions,
      metric_scores: scores,
      reflection_responses: reflections as unknown as Json[],
      curator_responses: curators,
      expected_playbook: out.playbook,
      expected_artifact: out.artifact,
    });
  }

  // ace-compile-curator-noop-filtered: the curator emits one substantive ADD
  // alongside two no-op acknowledgments ("No update required. Keep the existing
  // routing rule ... unchanged." and "The existing escalation rule remains
  // correct."). The deterministic normalize filter drops the acknowledgments so
  // only the real rule becomes a bullet; the lowered ports must filter the same.
  {
    const reflection: AxACEReflectionOutput = {
      reasoning: 'Refund requests were not routed to the right team.',
      errorIdentification: 'Refunds were not routed to team gamma',
      rootCauseAnalysis: 'No explicit refund routing rule',
      correctApproach: 'Route refund requests to team gamma',
      keyInsight: 'Refunds belong to team gamma',
      bulletTags: [],
    };
    const curator: Record<string, Json> = {
      reasoning:
        'Add the refund routing rule; everything else is already fine.',
      operations: [
        {
          type: 'ADD',
          section: 'Routing',
          bulletId: 'routing-00001',
          content: 'Route refund requests to team gamma.',
        },
        {
          type: 'ADD',
          section: 'Routing',
          bulletId: 'routing-00002',
          content:
            'No update required. Keep the existing routing rule to team gamma unchanged.',
        },
        {
          type: 'ADD',
          section: 'Routing',
          bulletId: 'routing-00003',
          content: 'The existing escalation rule remains correct.',
        },
      ],
    };
    const examples = [
      { question: 'Where do refund requests go?', answer: 'Team gamma' },
      { question: 'ping', answer: 'pong' },
    ];
    const predictions = [{ answer: 'Team beta' }, { answer: 'pong' }];
    const scores = [0.3, 1];
    const reflections = [reflection, aceResolvedReflection];
    const curators = [curator, aceNoopCurator];
    const out = await driveACECompile(
      examples,
      { maxEpochs: 1, maxReflectorRounds: 1 },
      { predictions, scores, reflections, curators }
    );
    writeFixture('ace-compile-curator-noop-filtered', {
      kind: 'optimize',
      operation: 'ace-compile',
      now: ACE_NOW,
      ace_options: { maxEpochs: 1, maxReflectorRounds: 1 },
      examples,
      generator_predictions: predictions,
      metric_scores: scores,
      reflection_responses: reflections as unknown as Json[],
      curator_responses: curators,
      expected_playbook: out.playbook,
      expected_artifact: out.artifact,
    });
  }

  // ace-compile-resolved-no-op: both examples resolve ("no error") and the
  // curator returns no operations, so the playbook stays empty (feedback only).
  {
    const examples = [
      { question: 'ping', answer: 'pong' },
      { question: 'ping2', answer: 'pong2' },
    ];
    const predictions = [{ answer: 'pong' }, { answer: 'pong2' }];
    const scores = [1, 1];
    const reflections = [aceResolvedReflection, aceResolvedReflection];
    const curators = [aceNoopCurator, aceNoopCurator];
    const out = await driveACECompile(
      examples,
      { maxEpochs: 1, maxReflectorRounds: 3 },
      { predictions, scores, reflections, curators }
    );
    writeFixture('ace-compile-resolved-no-op', {
      kind: 'optimize',
      operation: 'ace-compile',
      now: ACE_NOW,
      ace_options: { maxEpochs: 1, maxReflectorRounds: 3 },
      examples,
      generator_predictions: predictions,
      metric_scores: scores,
      reflection_responses: reflections as unknown as Json[],
      curator_responses: curators,
      expected_playbook: out.playbook,
      expected_artifact: out.artifact,
    });
  }

  // ace-compile-multi-round-reflection: the first example needs two reflection
  // rounds (round 1 reports an error, round 2 resolves) before the curator ADDs
  // a bullet; the second example resolves immediately with no op.
  {
    const reflection1: AxACEReflectionOutput = {
      reasoning: 'Initial pass: answer too terse.',
      errorIdentification: 'Answer lacks justification',
      rootCauseAnalysis: 'No reasoning step',
      correctApproach: 'Explain reasoning before answering',
      keyInsight: 'Show the work',
      bulletTags: [],
    };
    const reflection2: AxACEReflectionOutput = {
      reasoning: 'Second pass: refined insight.',
      errorIdentification: 'no error',
      rootCauseAnalysis: 'resolved after refinement',
      correctApproach: 'Explain reasoning then answer concisely',
      keyInsight: 'Reasoning first, then a concise answer',
      bulletTags: [],
    };
    const curator: Record<string, Json> = {
      reasoning: 'Capture the reasoning-first insight.',
      operations: [
        {
          type: 'ADD',
          section: 'Strategies',
          bulletId: 'strategies-00001',
          content: 'Explain reasoning first, then answer concisely.',
        },
      ],
    };
    const examples = [
      { question: 'Why is the sky blue?', answer: 'Rayleigh scattering.' },
      { question: 'ping', answer: 'pong' },
    ];
    const predictions = [
      { answer: 'Rayleigh scattering.' },
      { answer: 'pong' },
    ];
    const scores = [0.4, 1];
    const reflections = [reflection1, reflection2, aceResolvedReflection];
    const curators = [curator, aceNoopCurator];
    const out = await driveACECompile(
      examples,
      { maxEpochs: 1, maxReflectorRounds: 3 },
      { predictions, scores, reflections, curators }
    );
    writeFixture('ace-compile-multi-round-reflection', {
      kind: 'optimize',
      operation: 'ace-compile',
      now: ACE_NOW,
      ace_options: { maxEpochs: 1, maxReflectorRounds: 3 },
      examples,
      generator_predictions: predictions,
      metric_scores: scores,
      reflection_responses: reflections as unknown as Json[],
      curator_responses: curators,
      expected_playbook: out.playbook,
      expected_artifact: out.artifact,
    });
  }

  // ace-online-update-add: a single online update on a seeded playbook. The
  // reflector flags an error and the curator ADDs a bullet; the delta is
  // recorded in artifact.history with source "online".
  {
    const initialPlaybook = acePlaybook({
      Guidelines: [
        aceBullet('guidelines-00001', 'Guidelines', 'Be concise.', {
          helpfulCount: 1,
        }),
      ],
    });
    const reflection: AxACEReflectionOutput = {
      reasoning: 'User corrected a factual slip.',
      errorIdentification: 'Stated an incorrect fact',
      rootCauseAnalysis: 'No verification step',
      correctApproach: 'Verify facts before answering',
      keyInsight: 'Verify before committing',
      bulletTags: [{ id: 'guidelines-00001', tag: 'helpful' }],
    };
    const curator: Record<string, Json> = {
      reasoning: 'Add a verification guideline.',
      operations: [
        {
          type: 'ADD',
          section: 'Guidelines',
          bulletId: 'guidelines-00002',
          content: 'Verify facts before answering.',
        },
      ],
    };
    const out = await driveACEOnlineUpdate(
      initialPlaybook,
      {
        example: { question: 'q', answer: 'a' },
        prediction: { answer: 'bad' },
        feedback: 'User corrected the answer.',
      },
      { maxReflectorRounds: 1 },
      { reflections: [reflection], curators: [curator] }
    );
    writeFixture('ace-online-update-add', {
      kind: 'optimize',
      operation: 'ace-online-update',
      now: ACE_NOW,
      ace_options: { maxReflectorRounds: 1 },
      initial_playbook: clone(initialPlaybook) as unknown as Json,
      update: {
        example: { question: 'q', answer: 'a' },
        prediction: { answer: 'bad' },
        feedback: 'User corrected the answer.',
      },
      reflection_responses: [reflection as unknown as Json],
      curator_responses: [curator],
      expected_playbook: out.playbook,
      expected_artifact: out.artifact,
      expected_curator: out.curator,
    });
  }

  // A model may return one bullet tag object instead of an array. TS wraps the
  // object before curator target resolution; generated engines must do the
  // same so an id-less UPDATE targets the tagged harmful bullet.
  {
    const initialPlaybook = acePlaybook({
      Guidelines: [
        aceBullet('guidelines-00001', 'Guidelines', 'Be concise.'),
        aceBullet('guidelines-00002', 'Guidelines', 'Trust every draft fact.'),
      ],
    });
    const reflection = {
      reasoning: 'The draft trusted an unverified fact.',
      errorIdentification: 'Unverified fact',
      rootCauseAnalysis: 'The existing trust rule is harmful',
      correctApproach: 'Verify draft facts',
      keyInsight: 'Verification is required',
      bulletTags: { id: 'guidelines-00002', tag: 'harmful' },
    } as unknown as AxACEReflectionOutput;
    const curator: Record<string, Json> = {
      reasoning: 'Replace the harmful rule.',
      operations: [
        {
          type: 'UPDATE',
          section: 'Guidelines',
          content: 'Verify draft facts before using them.',
        },
      ],
    };
    const out = await driveACEOnlineUpdate(
      initialPlaybook,
      {
        example: { question: 'q', answer: 'a' },
        prediction: { answer: 'bad' },
      },
      { maxReflectorRounds: 1 },
      { reflections: [reflection], curators: [curator] }
    );
    writeFixture('ace-online-update-scalar-bullet-tag', {
      kind: 'optimize',
      operation: 'ace-online-update',
      now: ACE_NOW,
      ace_options: { maxReflectorRounds: 1 },
      initial_playbook: clone(initialPlaybook) as unknown as Json,
      update: {
        example: { question: 'q', answer: 'a' },
        prediction: { answer: 'bad' },
      },
      reflection_responses: [reflection as unknown as Json],
      curator_responses: [curator],
      expected_playbook: out.playbook,
      expected_artifact: out.artifact,
      expected_curator: out.curator,
    });
  }

  // The TS runtime normalizer is deliberately a shape guard, not a second
  // schema validator. Any string tag survives; only "harmful" is special and
  // every other string is a primary target. Keep that exact behavior so an
  // unexpected-but-string model value does not silently change UPDATE target
  // selection in generated runtimes.
  {
    const initialPlaybook = acePlaybook({
      Guidelines: [
        aceBullet('guidelines-00001', 'Guidelines', 'Keep the first rule.'),
        aceBullet('guidelines-00002', 'Guidelines', 'Revise this rule.'),
      ],
    });
    const reflection = {
      reasoning: 'The second rule needs revision.',
      errorIdentification: 'The second rule is stale',
      rootCauseAnalysis: 'Its guidance no longer applies',
      correctApproach: 'Replace the second rule',
      keyInsight: 'Target the tagged rule',
      bulletTags: [{ id: 'guidelines-00002', tag: 'unexpected' }],
    } as unknown as AxACEReflectionOutput;
    const curator: Record<string, Json> = {
      reasoning: 'Replace the tagged rule.',
      operations: [
        {
          type: 'UPDATE',
          section: 'Guidelines',
          content: 'Use the revised second rule.',
        },
      ],
    };
    const out = await driveACEOnlineUpdate(
      initialPlaybook,
      {
        example: { question: 'q', answer: 'a' },
        prediction: { answer: 'bad' },
      },
      { maxReflectorRounds: 1 },
      { reflections: [reflection], curators: [curator] }
    );
    writeFixture('ace-online-update-string-tag-shape', {
      kind: 'optimize',
      operation: 'ace-online-update',
      now: ACE_NOW,
      ace_options: { maxReflectorRounds: 1 },
      initial_playbook: clone(initialPlaybook) as unknown as Json,
      update: {
        example: { question: 'q', answer: 'a' },
        prediction: { answer: 'bad' },
      },
      reflection_responses: [reflection as unknown as Json],
      curator_responses: [curator],
      expected_playbook: out.playbook,
      expected_artifact: out.artifact,
      expected_curator: out.curator,
    });
  }
})();
