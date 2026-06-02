import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  computeEffectiveChatBudget,
  resolveContextPolicy,
  resolveExecutorModelPolicy,
  selectActorModelFromPolicy,
} from '../../../src/ax/agent/config.js';
import {
  buildActionLogParts,
  type ActionLogEntry,
} from '../../../src/ax/agent/contextManager.js';
import {
  classifyContextPressure,
  renderContextPressure,
} from '../../../src/ax/agent/contextEvents.js';
import { getRuntimeLanguageInfo } from '../../../src/ax/agent/rlm.js';
import { visibleRuntimePrimitives } from '../../../src/ax/agent/runtimePrimitives.js';
import {
  computeDynamicRuntimeChars,
  smartStringify,
} from '../../../src/ax/agent/truncate.js';
import { AxSignature } from '../../../src/ax/dsp/sig.js';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Fixture = Record<string, Json>;

const outDir = join(process.cwd(), 'ir/conformance/axagent');

function stable(value: unknown, parentKey = ''): unknown {
  if (Array.isArray(value)) return value.map((item) => stable(item, parentKey));
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const ordered =
      parentKey === 'input' ||
      parentKey === 'output' ||
      parentKey === 'expected_output' ||
      parentKey === 'options'
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
  AxSignature.create('question:string, document:string -> answer:string');
}

function runtimeContractSubset(language: string, usageInstructions?: string) {
  const info = getRuntimeLanguageInfo({ language });
  return {
    language: info.languageName,
    code_field_name: info.codeFieldName,
    code_field_title: info.codeFieldTitle,
    code_fence_language: info.codeFenceLanguage,
    is_javascript: info.isJavaScript,
    ...(usageInstructions ? { usage_instructions: usageInstructions } : {}),
  };
}

function visiblePrimitiveIds(
  stage: 'distiller' | 'executor',
  flags: Record<string, boolean>
): string[] {
  return visibleRuntimePrimitives(stage, flags).map(
    (primitive) => primitive.id
  );
}

function primitiveSubset(ids: string[]): Json[] {
  return ids.map((id) => ({ id }));
}

function errorMessage(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected reference call to throw');
}

function contextPolicySubset(
  options?: Parameters<typeof resolveContextPolicy>[0],
  maxRuntimeChars?: number
): Json {
  const policy = resolveContextPolicy(options, undefined, maxRuntimeChars);
  return {
    preset: policy.preset,
    budget: policy.budget,
    actionReplay: policy.actionReplay,
    recentFullActions: policy.recentFullActions,
    contextHygiene: policy.contextHygiene as Json,
    stateSummary: policy.stateSummary as Json,
    stateInspection: policy.stateInspection as Json,
    checkpoints: policy.checkpoints as Json,
    targetPromptChars: policy.targetPromptChars,
    maxRuntimeChars: policy.maxRuntimeChars,
  };
}

const compactingActionLog: ActionLogEntry[] = [
  {
    turn: 1,
    code: 'const docs = search({ query: inputs.question })',
    output: JSON.stringify(
      Array.from({ length: 24 }, (_, index) => ({
        id: index,
        title: `Document ${index}`,
      }))
    ),
    tags: [],
    producedVars: ['docs'],
    stateDelta: 'docs loaded',
    stepKind: 'query',
  },
  {
    turn: 2,
    code: 'const answer = docs[0].title',
    output: 'Document 0',
    tags: [],
    producedVars: ['answer'],
    referencedVars: ['docs'],
    stateDelta: 'answer ready',
    stepKind: 'finalize',
  },
];

const checkpointSummary =
  'Objective: answer\nCurrent state and artifacts: docs loaded\nExact callables and formats: tools.search\nEvidence: Turn 1 loaded docs\nUser constraints and preferences: none\nFailures to avoid: none\nNext step: answer from latest runtime state.';

mkdirSync(outDir, { recursive: true });
for (const file of readdirSync(outDir)) {
  if (file.endsWith('.json')) rmSync(join(outDir, file));
}
touchReferenceBehavior();

writeFixture('simple-pipeline', {
  kind: 'agent_forward',
  signature: 'question:string -> answer:string',
  options: { contextFields: [] },
  input: { question: 'Capital of France?' },
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
  expected_output: { answer: 'Paris' },
  expected_request_count: 3,
  expected_request_contains: [
    'Capital of France?',
    'Executor Request',
    'Answer the question',
  ],
  expected_chat_log_subset: [
    { name: 'distiller', stage: 'ctx' },
    { name: 'executor', stage: 'task' },
    { name: 'responder', stage: 'task' },
  ],
});

writeFixture('context-routing', {
  kind: 'agent_forward',
  signature: 'question:string, document:string -> answer:string',
  options: { contextFields: ['document'] },
  input: {
    question: 'What does the document say?',
    document: 'Large document: AxIR is portable.',
  },
  responses: [
    {
      content:
        '{"completion":{"type":"final","args":["Use distilled context",{"summary":"AxIR is portable"}]}}',
    },
    {
      content:
        '{"completion":{"type":"final","args":["Answer from evidence",{"answer":"AxIR is portable"}]}}',
    },
    { content: '{"answer":"AxIR is portable"}' },
  ],
  expected_output: { answer: 'AxIR is portable' },
  expected_request_count: 3,
  expected_request_contains: [
    'Large document',
    'Distilled Context',
    'AxIR is portable',
  ],
  expected_chat_log_subset: [
    { name: 'distiller', stage: 'ctx' },
    { name: 'executor', stage: 'task' },
    { name: 'responder', stage: 'task' },
  ],
});

writeFixture('clarification', {
  kind: 'agent_forward',
  signature: 'question:string -> answer:string',
  options: { contextFields: [] },
  input: { question: 'Book it' },
  responses: [
    {
      content: '{"completion":{"type":"final","args":["Clarify booking",{}]}}',
    },
    {
      content:
        '{"completion":{"type":"askClarification","args":[{"question":"Which city?","type":"text"}]}}',
    },
  ],
  expected_error_contains: 'Which city',
  expected_clarification: { question: 'Which city?', type: 'text' },
});

writeFixture('exclude-fields', {
  kind: 'agent_forward',
  signature:
    'question:string, document:string, secret:string, scratch?:string -> answer:string',
  options: {
    contextFields: ['document'],
    executorOptions: { excludeFields: ['secret'] },
    responderOptions: { excludeFields: ['scratch'] },
  },
  input: {
    question: 'Answer safely',
    document: 'public context',
    secret: 'do-not-send-to-executor',
    scratch: 'do-not-send-to-responder',
  },
  responses: [
    {
      content:
        '{"completion":{"type":"final","args":["Answer safely",{"evidence":"public"}]}}',
    },
    {
      content:
        '{"completion":{"type":"final","args":["Answer safely",{"answer":"safe"}]}}',
    },
    { content: '{"answer":"safe"}' },
  ],
  expected_output: { answer: 'safe' },
  expected_request_count: 3,
  expected_stage_request_not_contains: [
    { index: 1, absent: ['do-not-send-to-executor'] },
    { index: 2, absent: ['do-not-send-to-responder'] },
  ],
});

writeFixture('state-round-trip', {
  kind: 'agent_forward',
  signature: 'question:string -> answer:string',
  options: { contextFields: [] },
  set_state: { session: 'alpha' },
  input: { question: 'Remember session' },
  responses: [
    {
      content: '{"completion":{"type":"final","args":["Answer",{}]}}',
    },
    {
      content:
        '{"completion":{"type":"final","args":["Answer",{"answer":"ok"}]}}',
    },
    { content: '{"answer":"ok"}' },
  ],
  expected_output: { answer: 'ok' },
  expected_state: { session: 'alpha' },
  expected_request_count: 3,
});

writeFixture('config-validation', {
  kind: 'agent_forward',
  signature: 'question:string -> answer:string',
  options: { contextFields: ['missing'] },
  input: { question: 'hello' },
  responses: [],
  expected_error_contains: 'context field not found: missing',
});

writeFixture('runtime-metadata-javascript', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    runtime: {
      language: 'javascript',
    },
  },
  expected_runtime_contract_subset: {
    ...runtimeContractSubset('javascript'),
    callable_format: 'namespaced_runtime_call',
  },
  expected_policy_subset: {
    policy_version: 'agent-runtime-decision-v1',
    discovery_default: 'compact_catalog_prompt_full_docs_runtime_discover',
    delegation_default: 'child_agents_as_namespaced_tools',
    discover_returns: 'void',
  },
});

writeFixture('runtime-metadata-python', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    runtime: {
      language: 'python',
      usageInstructions:
        'Use pythonCode to call tools through namespaced runtime functions.',
    },
  },
  expected_runtime_contract_subset: {
    ...runtimeContractSubset(
      'python',
      'Use pythonCode to call tools through namespaced runtime functions.'
    ),
  },
});

writeFixture('policy-registry-baseline', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    runtime: { language: 'JavaScript' },
  },
  expected_policy_subset: {
    policy_version: 'agent-runtime-decision-v1',
    policy_schema_version: 'axir-agent-policy-v1',
  },
  expected_policy_registry_subset: {
    policy_version: 'agent-runtime-decision-v1',
    policy_schema_version: 'axir-agent-policy-v1',
    flags: {
      discoveryMode: false,
      skillsMode: false,
      memoriesMode: false,
      usageTrackingMode: false,
      hasAgentStatusCallback: false,
      hasInspectRuntime: false,
    },
    vocabulary: {
      policy_schema_version: 'axir-agent-policy-vocabulary-v1',
      actor_primitive_names: {
        final: 'final',
        ask_clarification: 'askClarification',
        discover: 'discover',
        recall: 'recall',
      },
      context_policy: {
        default_preset: 'checkpointed',
        default_budget: 'balanced',
        option_keys: {
          camel: 'contextPolicy',
          snake: 'context_policy',
          preset: 'preset',
          budget: 'budget',
        },
        budgets: {
          compact: { targetPromptChars: 12000, inspectThreshold: 10200 },
          balanced: { targetPromptChars: 16000, inspectThreshold: 13600 },
          expanded: { targetPromptChars: 20000, inspectThreshold: 17000 },
        },
        presets: {
          adaptive: {
            actionReplay: 'adaptive',
            checkpointTriggerRatio: 0.75,
          },
          lean: {
            actionReplay: 'minimal',
            checkpointTriggerRatio: 0.6,
          },
          checkpointed: {
            actionReplay: 'checkpointed',
            checkpointTriggerRatio: 1,
          },
        },
        pressure_levels: {
          ok: { id: 'ok', threshold: 0 },
          watch: { id: 'watch', threshold: 0.7 },
          critical: { id: 'critical', threshold: 0.9 },
        },
        event_names: {
          budget_check: 'budget_check',
          action_compacted: 'action_compacted',
          checkpoint_created: 'checkpoint_created',
          checkpoint_cleared: 'checkpoint_cleared',
        },
      },
      effect_only_actions: ['discover', 'recall', 'used'],
    },
  },
  expected_actor_primitives_subset: primitiveSubset(
    visiblePrimitiveIds('executor', {})
  ),
  expected_protocol_actions_subset: [
    { id: 'final', category: 'protocol_action', actor_visible: false },
    {
      id: 'askClarification',
      category: 'protocol_action',
      actor_visible: false,
    },
    { id: 'guideAgent', category: 'protocol_action', actor_visible: false },
  ],
  expected_runtime_globals_subset: [
    { id: 'inputs', category: 'runtime_global' },
  ],
});

writeFixture('policy-registry-all-enabled', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    functionDiscovery: true,
    skillsMode: true,
    memoriesMode: true,
    usageTrackingMode: true,
    hasAgentStatusCallback: true,
    hasInspectRuntime: true,
    runtime: { language: 'JavaScript' },
  },
  expected_policy_registry_subset: {
    flags: {
      discoveryMode: true,
      skillsMode: true,
      memoriesMode: true,
      usageTrackingMode: true,
      hasAgentStatusCallback: true,
      hasInspectRuntime: true,
    },
  },
  expected_actor_primitives_subset: primitiveSubset(
    visiblePrimitiveIds('executor', {
      discoveryMode: true,
      skillsMode: true,
      memoriesMode: true,
      usageTrackingMode: true,
      hasAgentStatusCallback: true,
      hasInspectRuntime: true,
    })
  ),
  expected_protocol_actions_subset: [
    { id: 'guideAgent', category: 'protocol_action', actor_visible: false },
    { id: 'success', category: 'protocol_action', actor_visible: false },
    { id: 'failed', category: 'protocol_action', actor_visible: false },
  ],
  expected_host_boundaries_subset: [
    { id: 'memory_search', category: 'host_boundary' },
    { id: 'skill_search', category: 'host_boundary' },
    { id: 'status_callback', category: 'host_boundary' },
    { id: 'runtime_inspection', category: 'host_boundary' },
  ],
});

writeFixture('policy-registry-used-namespace-currently-allowed', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    usageTrackingMode: true,
    functions: [
      {
        namespace: 'used',
        title: 'Used Namespace',
        functions: [
          { name: 'mark', description: 'Current TS allows this edge' },
        ],
      },
    ],
  },
  expected_callable_inventory_subset: [
    {
      namespace: 'used',
      callables: [
        {
          name: 'mark',
          namespace: 'used',
          qualified_name: 'used.mark',
          kind: 'tool',
          description: 'Current TS allows this edge',
          parameters: null,
          always_include: false,
        },
      ],
    },
  ],
  expected_policy_registry_subset: {
    flags: { usageTrackingMode: true },
  },
});

for (const language of [
  'JavaScript',
  'js',
  'ecmascript',
  'Python',
  'TypeScript',
  'C#',
  'C++',
  '!!!',
]) {
  const name = `runtime-language-${
    language
      .replace(/#/g, '-sharp-')
      .replace(/\+/g, '-plus-')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'fallback'
  }`;
  writeFixture(name, {
    kind: 'agent_runtime_policy',
    signature: 'question:string -> answer:string',
    options: {
      runtime: { language },
    },
    expected_runtime_contract_subset: runtimeContractSubset(language),
  });
}

writeFixture('actor-prompt-cache-policy-python', {
  kind: 'agent_runtime_policy',
  signature: 'document:string, question:string -> answer:string',
  options: {
    contextFields: ['document'],
    functionDiscovery: true,
    runtime: { language: 'Python' },
  },
  expected_runtime_contract_subset: runtimeContractSubset('Python'),
  expected_exported_state_subset: {
    actor_prompt_policy: {
      stable_cached_fields: [
        'input',
        'executorRequest',
        'distilledContext',
        'contextMetadata',
        'contextMap',
        'memories',
        'discoveredToolDocs',
        'loadedSkills',
        'summarizedActorLog',
      ],
      dynamic_uncached_fields: [
        'guidanceLog',
        'actionLog',
        'liveRuntimeState',
        'contextPressure',
      ],
      code_field_name: 'pythonCode',
      code_field_title: 'Python Code',
      code_fence_language: 'python',
      cache_order: 'stable_before_dynamic',
    },
  },
});

writeFixture('context-policy-default-checkpointed-balanced', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  context_operation: 'resolve_policy',
  expected_context_result_subset: contextPolicySubset(),
});

writeFixture('context-policy-lean-compact-budget', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    contextPolicy: { preset: 'lean', budget: 'compact' },
    maxRuntimeChars: 1500,
  },
  context_operation: 'resolve_policy',
  expected_context_result_subset: contextPolicySubset(
    { preset: 'lean', budget: 'compact' },
    1500
  ),
});

writeFixture('context-policy-state-migration-error', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    contextPolicy: { state: { maxEntries: 2 } },
  },
  context_operation: 'resolve_policy',
  expected_error_contains:
    errorMessage(() =>
      resolveContextPolicy({ state: { maxEntries: 2 } } as never)
    ),
});

writeFixture('context-policy-checkpoints-migration-error', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    contextPolicy: { checkpoints: { triggerChars: 1 } },
  },
  context_operation: 'resolve_policy',
  expected_error_contains: errorMessage(() =>
    resolveContextPolicy({ checkpoints: { triggerChars: 1 } } as never)
  ),
});

writeFixture('context-policy-summarizer-migration-error', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    contextPolicy: { summarizerOptions: { model: 'mini' } },
  },
  context_operation: 'resolve_policy',
  expected_error_contains: errorMessage(() =>
    resolveContextPolicy({ summarizerOptions: { model: 'mini' } } as never)
  ),
});

writeFixture('context-policy-unknown-key-migration-error', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    contextPolicy: { maxEntries: 2 },
  },
  context_operation: 'resolve_policy',
  expected_error_contains: errorMessage(() =>
    resolveContextPolicy({ maxEntries: 2 } as never)
  ),
});

writeFixture('executor-model-policy-routing', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    executorModelPolicy: [
      { model: 'standard', aboveErrorTurns: 2 },
      { model: 'tools-model', namespaces: ['docs'] },
    ],
  },
  actor_model_state: {
    consecutiveErrorTurns: 1,
    matchedNamespaces: ['docs'],
  },
  context_operation: 'executor_model_policy',
  expected_context_result_subset: {
    selectedModel: selectActorModelFromPolicy(
      resolveExecutorModelPolicy([
        { model: 'standard', aboveErrorTurns: 2 },
        { model: 'tools-model', namespaces: ['docs'] },
      ])!,
      1,
      ['docs']
    )!,
  },
});

writeFixture('executor-model-policy-legacy-error', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    executorModelPolicy: [{ model: 'old', abovePromptChars: 12000 }],
  },
  context_operation: 'executor_model_policy',
  expected_error_contains: errorMessage(() =>
    resolveExecutorModelPolicy([
      { model: 'old', abovePromptChars: 12000 },
    ] as never)
  ),
});

writeFixture('executor-model-policy-expanded-legacy-error', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    executorModelPolicy: [{ model: 'old', minEscalatedTurns: 2 }],
  },
  context_operation: 'executor_model_policy',
  expected_error_contains: errorMessage(() =>
    resolveExecutorModelPolicy([
      { model: 'old', minEscalatedTurns: 2 },
    ] as never)
  ),
});

writeFixture('executor-model-policy-negative-error-turns', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    executorModelPolicy: [{ model: 'retry', aboveErrorTurns: -1 }],
  },
  context_operation: 'executor_model_policy',
  expected_error_contains: errorMessage(() =>
    resolveExecutorModelPolicy([
      { model: 'retry', aboveErrorTurns: -1 },
    ] as never)
  ),
});

writeFixture('executor-model-policy-empty-namespaces', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    executorModelPolicy: [{ model: 'tools', namespaces: ['  '] }],
  },
  context_operation: 'executor_model_policy',
  expected_error_contains: errorMessage(() =>
    resolveExecutorModelPolicy([
      { model: 'tools', namespaces: ['  '] },
    ] as never)
  ),
});

const effectiveBudget = computeEffectiveChatBudget(16000, 6000);
const budgetPressure = classifyContextPressure({
  mutablePromptChars: 10000,
  effectiveBudgetChars: effectiveBudget,
  checkpointActive: false,
});
writeFixture('context-budget-runtime-decay', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  context_operation: 'budget',
  base_budget: 16000,
  fixed_overhead_chars: 6000,
  mutable_prompt_chars: 10000,
  max_runtime_chars: 3000,
  action_log: [
    {
      code: 'x'.repeat(1000),
      output: 'y'.repeat(3000),
    },
  ],
  expected_context_result_subset: {
    effectiveBudgetChars: effectiveBudget,
    dynamicRuntimeChars: computeDynamicRuntimeChars(
      [{ code: 'x'.repeat(1000), output: 'y'.repeat(3000) }],
      16000,
      3000
    ),
    pressure: budgetPressure,
    contextPressure: renderContextPressure(budgetPressure),
  },
});

writeFixture('context-smart-stringify-large-array', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  context_operation: 'smart_stringify',
  value: Array.from({ length: 12 }, (_, index) => index),
  max_chars: 400,
  expected_context_result: {
    text: smartStringify(
      Array.from({ length: 12 }, (_, index) => index),
      400
    ),
  },
});

const checkpointParts = buildActionLogParts(compactingActionLog, {
  actionReplay: 'checkpointed',
  recentFullActions: 1,
  checkpointSummary,
  checkpointTurns: [1],
  hygieneMode: 'pressure',
});
writeFixture('context-action-log-checkpoint-replay', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    runtime: { language: 'JavaScript' },
    contextPolicy: { preset: 'checkpointed', budget: 'compact' },
  },
  context_operation: 'prepare',
  action_log: compactingActionLog as unknown as Json[],
  checkpoint_state: {
    fingerprint: '[1]',
    summary: checkpointSummary,
    turns: [1],
  },
  expected_context_result_subset: {
    prepared: {
      summarizedActorLog: checkpointParts.summary,
      actionLog: checkpointParts.history,
      pressure: 'critical',
      contextPressure: renderContextPressure('critical'),
    },
  },
  expected_context_events_subset: [
    {
      kind: 'budget_check',
      stage: 'executor',
      pressure: 'critical',
      checkpointActive: true,
    },
  ],
});

writeFixture('context-action-log-pressure-compaction', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    runtime: { language: 'JavaScript' },
    contextPolicy: { preset: 'lean', budget: 'compact' },
  },
  context_operation: 'prepare',
  action_log: compactingActionLog as unknown as Json[],
  expected_context_result_subset: {
    prepared: {
      pressure: 'ok',
    },
  },
  expected_context_events_subset: [
    {
      kind: 'action_compacted',
      stage: 'executor',
      turn: 1,
      mode: 'compact',
      reason: 'lean',
    },
  ],
});

writeFixture('context-runtime-state-summary', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    runtime: { language: 'JavaScript' },
    contextPolicy: { preset: 'adaptive', budget: 'balanced' },
  },
  context_operation: 'prepare',
  runtime_session_state: {
    globals: {
      alpha: 1,
      beta: { ok: true },
      final: 'reserved and not rendered',
    },
  },
  expected_context_result_subset: {
    prepared: {
      liveRuntimeState: 'Current runtime state:\n- alpha: 1\n- beta: {"ok":true}',
    },
  },
});

writeFixture('context-checkpoint-fallback-created', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    runtime: { language: 'JavaScript' },
    contextPolicy: { preset: 'lean', budget: 'compact' },
  },
  context_operation: 'prepare',
  action_log: [
    {
      turn: 1,
      code: 'const docs = search(inputs.question)',
      output: 'x'.repeat(8000),
      tags: [],
      producedVars: ['docs'],
      stateDelta: 'docs loaded',
      stepKind: 'query',
    },
    {
      turn: 2,
      code: 'const answer = docs.slice(0, 1)',
      output: 'answer ready',
      tags: [],
      producedVars: ['answer'],
      referencedVars: ['docs'],
      stateDelta: 'answer ready',
      stepKind: 'finalize',
    },
  ],
  expected_context_result_subset: {
    exported: {
      checkpoint_state: {
        turns: [1],
      },
    },
  },
  expected_context_events_subset: [
    {
      kind: 'checkpoint_created',
      stage: 'executor',
      reason: 'over_budget',
      coveredTurns: [1],
    },
  ],
});

writeFixture('runtime-forward-python-final', {
  kind: 'agent_forward',
  signature: 'question:string -> answer:string',
  options: {
    runtime: { language: 'Python' },
  },
  input: { question: 'Use runtime' },
  responses: [
    {
      content:
        '{"completion":{"type":"final","args":["Execute runtime code",{}]}}',
    },
    {
      content:
        '{"pythonCode":"final(\\"Answer\\", {\\"answer\\": \\"from runtime\\"})"}',
    },
    { content: '{"answer":"from runtime"}' },
  ],
  runtime_script: [
    {
      expected_code: 'final("Answer", {"answer": "from runtime"})',
      result: {
        type: 'final',
        args: ['Answer', { answer: 'from runtime' }],
      },
    },
  ],
  expected_output: { answer: 'from runtime' },
  expected_request_count: 3,
  expected_executed: ['final("Answer", {"answer": "from runtime"})'],
  expected_runtime_contract_subset: runtimeContractSubset('Python'),
  expected_action_log_subset: [
    { type: 'runtime_session', action: 'create_session' },
    { kind: 'final', code: 'final("Answer", {"answer": "from runtime"})' },
  ],
});

writeFixture('runtime-forward-javascript-final', {
  kind: 'agent_forward',
  signature: 'question:string -> answer:string',
  options: {
    runtime: { language: 'JavaScript' },
  },
  input: { question: 'Use runtime' },
  responses: [
    {
      content:
        '{"completion":{"type":"final","args":["Execute runtime code",{}]}}',
    },
    {
      content:
        '{"javascriptCode":"final(\\"Answer\\", {\\"answer\\": \\"from runtime\\"})"}',
    },
    { content: '{"answer":"from runtime"}' },
  ],
  runtime_script: [
    {
      expected_code: 'final("Answer", {"answer": "from runtime"})',
      result: {
        type: 'final',
        args: ['Answer', { answer: 'from runtime' }],
      },
    },
  ],
  expected_output: { answer: 'from runtime' },
  expected_request_count: 3,
  expected_executed: ['final("Answer", {"answer": "from runtime"})'],
  expected_runtime_contract_subset: runtimeContractSubset('JavaScript'),
  expected_action_log_subset: [
    { type: 'runtime_session', action: 'create_session' },
    { kind: 'final', code: 'final("Answer", {"answer": "from runtime"})' },
  ],
});

writeFixture('trace-replay-runtime-final', {
  kind: 'agent_forward',
  signature: 'question:string -> answer:string',
  options: {
    runtime: { language: 'Python' },
  },
  input: { question: 'Trace runtime' },
  responses: [
    {
      content:
        '{"completion":{"type":"final","args":["Execute runtime code",{}]}}',
    },
    {
      content:
        '{"pythonCode":"final(\\"Answer\\", {\\"answer\\": \\"trace ok\\"})"}',
    },
    { content: '{"answer":"trace ok"}' },
  ],
  runtime_script: [
    {
      expected_code: 'final("Answer", {"answer": "trace ok"})',
      result: {
        type: 'final',
        args: ['Answer', { answer: 'trace ok' }],
      },
    },
  ],
  expected_output: { answer: 'trace ok' },
  expected_request_count: 3,
  expected_trace_subset: {
    schema_version: 'axir-agent-trace-v1',
    kind: 'agent_run',
    status: 'completed',
    replayable: true,
    final_output: { answer: 'trace ok' },
    optimizer_metadata: {
      policy_version: 'agent-runtime-decision-v1',
    },
  },
  expected_trace_event_kinds: [
    'stage_request',
    'stage_response',
    'stage_request',
    'stage_response',
    'runtime_lifecycle',
    'runtime_execute',
    'final',
    'stage_request',
    'stage_response',
    'final',
  ],
  replay_trace: true,
  expected_replay_result_subset: {
    ok: true,
    status: 'replayed',
    output: { answer: 'trace ok' },
  },
});

writeFixture('runtime-forward-discover-continues', {
  kind: 'agent_forward',
  signature: 'question:string -> answer:string',
  options: {
    functionDiscovery: true,
    runtime: { language: 'Python' },
    functions: [{ name: 'search', description: 'Search docs' }],
  },
  input: { question: 'Find docs' },
  responses: [
    {
      content:
        '{"completion":{"type":"final","args":["Discover tools first",{}]}}',
    },
    {
      content: '{"pythonCode":"discover({\\"tools\\":[\\"search\\"]})"}',
    },
    {
      content:
        '{"pythonCode":"final(\\"Answer\\", {\\"answer\\": \\"Docs found\\"})"}',
    },
    { content: '{"answer":"Docs found"}' },
  ],
  runtime_script: [
    {
      expected_code: 'discover({"tools":["search"]})',
      result: { discover: { tools: ['search'] } },
    },
    {
      expected_code: 'final("Answer", {"answer": "Docs found"})',
      result: {
        type: 'final',
        args: ['Answer', { answer: 'Docs found' }],
      },
    },
  ],
  expected_output: { answer: 'Docs found' },
  expected_request_count: 4,
  expected_request_contains: ['Search docs', 'Discovered Tool Docs'],
  expected_executed: [
    'discover({"tools":["search"]})',
    'final("Answer", {"answer": "Docs found"})',
  ],
  expected_action_log_subset: [
    { kind: 'result', code: 'discover({"tools":["search"]})' },
    { type: 'discover', request: { tools: ['search'] } },
    { kind: 'final', code: 'final("Answer", {"answer": "Docs found"})' },
  ],
});

writeFixture('runtime-forward-recall-continues', {
  kind: 'agent_forward',
  signature: 'question:string -> answer:string',
  options: {
    memoriesMode: true,
    runtime: { language: 'Python' },
    memory_search_results: {
      prefs: [{ id: 'mem-1', content: 'User likes concise docs.' }],
    },
  },
  input: { question: 'Use memory' },
  responses: [
    {
      content:
        '{"completion":{"type":"final","args":["Recall preferences",{}]}}',
    },
    { content: '{"pythonCode":"recall(\\"prefs\\")"}' },
    {
      content:
        '{"pythonCode":"final(\\"Answer\\", {\\"answer\\": \\"User likes concise docs.\\"})"}',
    },
    { content: '{"answer":"User likes concise docs."}' },
  ],
  runtime_script: [
    {
      expected_code: 'recall("prefs")',
      result: { kind: 'recall', recall: 'prefs' },
    },
    {
      expected_code: 'final("Answer", {"answer": "User likes concise docs."})',
      result: {
        type: 'final',
        args: ['Answer', { answer: 'User likes concise docs.' }],
      },
    },
  ],
  expected_output: { answer: 'User likes concise docs.' },
  expected_request_count: 4,
  expected_request_contains: ['User likes concise docs.'],
  expected_executed: [
    'recall("prefs")',
    'final("Answer", {"answer": "User likes concise docs."})',
  ],
  expected_exported_state_subset: {
    loaded_memories: [{ id: 'mem-1', content: 'User likes concise docs.' }],
  },
  expected_action_log_subset: [
    { type: 'recall', searches: ['prefs'] },
    {
      kind: 'final',
      code: 'final("Answer", {"answer": "User likes concise docs."})',
    },
  ],
});

writeFixture('runtime-forward-guide-continues', {
  kind: 'agent_forward',
  signature: 'question:string -> answer:string',
  options: {
    runtime: { language: 'Python' },
  },
  input: { question: 'Use guidance' },
  responses: [
    {
      content:
        '{"completion":{"type":"final","args":["Guide before answering",{}]}}',
    },
    { content: '{"pythonCode":"guideAgent(\\"Prefer concise final.\\")"}' },
    {
      content:
        '{"pythonCode":"final(\\"Answer\\", {\\"answer\\": \\"Concise\\"})"}',
    },
    { content: '{"answer":"Concise"}' },
  ],
  runtime_script: [
    {
      expected_code: 'guideAgent("Prefer concise final.")',
      result: { type: 'guide_agent', guidance: 'Prefer concise final.' },
    },
    {
      expected_code: 'final("Answer", {"answer": "Concise"})',
      result: {
        type: 'final',
        args: ['Answer', { answer: 'Concise' }],
      },
    },
  ],
  expected_output: { answer: 'Concise' },
  expected_request_count: 4,
  expected_request_contains: ['Prefer concise final.'],
  expected_executed: [
    'guideAgent("Prefer concise final.")',
    'final("Answer", {"answer": "Concise"})',
  ],
  expected_exported_state_subset: {
    guidance_log: [{ turn: 1, guidance: 'Prefer concise final.' }],
  },
  expected_action_log_subset: [
    { type: 'guide_agent', guidance: 'Prefer concise final.' },
    { kind: 'final', code: 'final("Answer", {"answer": "Concise"})' },
  ],
});

writeFixture('trace-max-step-error', {
  kind: 'agent_forward',
  signature: 'question:string -> answer:string',
  options: {
    runtime: { language: 'Python' },
  },
  forward_options: {
    max_actor_steps: 1,
  },
  input: { question: 'Never finish' },
  responses: [
    {
      content: '{"completion":{"type":"final","args":["Try runtime",{}]}}',
    },
    {
      content: '{"pythonCode":"reportSuccess(\\"still working\\")"}',
    },
  ],
  runtime_script: [
    {
      expected_code: 'reportSuccess("still working")',
      result: {
        kind: 'status',
        status: { type: 'success', message: 'still working' },
      },
    },
  ],
  expected_error_contains: 'agent actor loop exceeded max steps',
  expected_trace_event_kinds: [
    'stage_request',
    'stage_response',
    'stage_request',
    'stage_response',
    'runtime_lifecycle',
    'runtime_execute',
    'status',
    'error',
  ],
  replay_trace: true,
});

writeFixture('agent-context-cache-precedence', {
  kind: 'agent_forward',
  signature: 'document:string, question:string -> answer:string',
  options: {
    contextFields: ['document'],
    contextCache: { ttlSeconds: 1111 },
    contextOptions: {
      contextCache: { ttlSeconds: 2222, cacheBreakpoint: 'system' },
    },
    executorOptions: {
      contextCache: { ttlSeconds: 3333, cacheBreakpoint: 'after-functions' },
    },
    responderOptions: {
      contextCache: { ttlSeconds: 4444, cacheBreakpoint: 'after-examples' },
    },
  },
  forward_options: {
    contextCache: { ttlSeconds: 5555, cacheBreakpoint: 'system' },
  },
  input: { document: 'cached context', question: 'q' },
  responses: [
    {
      content:
        '{"completion":{"type":"final","args":["Answer with cache",{"summary":"cached"}]}}',
    },
    {
      content:
        '{"completion":{"type":"final","args":["Answer with cache",{"answer":"cached"}]}}',
    },
    { content: '{"answer":"cached"}' },
  ],
  expected_output: { answer: 'cached' },
  expected_request_count: 3,
  expected_cached_request_indices: [0, 1, 2],
});

writeFixture('reserved-runtime-name-conflict', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    functions: [
      {
        namespace: 'final',
        functions: [{ name: 'save', description: 'Save a result' }],
      },
    ],
  },
  expected_error_contains:
    'agent callable namespace conflicts with reserved runtime name: final',
});

writeFixture('flat-functions-always-inline', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    functions: [
      { name: 'search', description: 'Search docs' },
      { name: 'lookup', description: 'Look up an id' },
    ],
  },
  expected_callable_inventory_subset: [
    {
      namespace: 'tools',
      always_include: true,
      callables: [
        {
          name: 'search',
          namespace: 'tools',
          qualified_name: 'tools.search',
          kind: 'tool',
          description: 'Search docs',
          parameters: null,
          always_include: false,
        },
        {
          name: 'lookup',
          namespace: 'tools',
          qualified_name: 'tools.lookup',
          kind: 'tool',
          description: 'Look up an id',
          parameters: null,
          always_include: false,
        },
      ],
    },
  ],
  expected_discovery_catalog_subset: [
    {
      namespace: 'tools',
      placement: 'actor_prompt',
      callables: ['tools.search', 'tools.lookup'],
    },
  ],
});

writeFixture('grouped-discoverable-module', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    functions: [
      {
        namespace: 'docs',
        title: 'Docs',
        selectionCriteria: 'Use when answering from documentation',
        functions: [
          { name: 'search', description: 'Search documentation' },
          { name: 'read', description: 'Read a page' },
        ],
      },
    ],
  },
  expected_callable_inventory_subset: [
    {
      namespace: 'docs',
      title: 'Docs',
      selection_criteria: 'Use when answering from documentation',
      always_include: false,
      callables: [
        {
          name: 'search',
          namespace: 'docs',
          qualified_name: 'docs.search',
          kind: 'tool',
          description: 'Search documentation',
          parameters: null,
          always_include: false,
        },
        {
          name: 'read',
          namespace: 'docs',
          qualified_name: 'docs.read',
          kind: 'tool',
          description: 'Read a page',
          parameters: null,
          always_include: false,
        },
      ],
    },
  ],
  expected_discovery_catalog_subset: [
    { namespace: 'docs', placement: 'discover', hint: 'discover tools docs' },
  ],
});

writeFixture('always-include-group', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    functions: [
      {
        namespace: 'math',
        alwaysInclude: true,
        functions: [{ name: 'sum', description: 'Add numbers' }],
      },
    ],
  },
  expected_discovery_catalog_subset: [
    { namespace: 'math', placement: 'actor_prompt', callables: ['math.sum'] },
  ],
});

writeFixture('child-agent-callable-metadata', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    functions: [
      {
        namespace: 'agents',
        alwaysInclude: true,
        functions: [
          {
            name: 'researcher',
            kind: 'agent',
            description: 'Delegate research tasks',
          },
        ],
      },
    ],
  },
  expected_callable_inventory_subset: [
    {
      namespace: 'agents',
      callables: [
        {
          name: 'researcher',
          namespace: 'agents',
          qualified_name: 'agents.researcher',
          kind: 'agent',
          description: 'Delegate research tasks',
          parameters: null,
          always_include: false,
        },
      ],
    },
  ],
});

writeFixture('discover-tools-mutates-next-prompt-state', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    functionDiscovery: true,
    functions: [
      {
        namespace: 'docs',
        functions: [{ name: 'search', description: 'Search documentation' }],
      },
    ],
  },
  discover: { tools: ['docs'] },
  expected_discover_result: null,
  expected_discovered_tool_docs_subset: [
    {
      namespace: 'docs',
      name: 'search',
      qualified_name: 'docs.search',
      description: 'Search documentation',
    },
  ],
  expected_policy_trace_subset: [
    { type: 'discover', tools: ['docs'], skills: [] },
  ],
});

writeFixture('discover-skills-mutates-next-prompt-state', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    skillsMode: true,
  },
  discover: { skills: ['sql'] },
  expected_discover_result: null,
  expected_loaded_skill_docs_subset: [
    { name: 'sql', content: 'Skill docs loaded for sql' },
  ],
  expected_policy_trace_subset: [
    { type: 'discover', tools: [], skills: ['sql'] },
  ],
});

writeFixture('discover-function-dedupes-and-summarizes', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    functionDiscovery: true,
    functions: [
      {
        namespace: 'docs',
        title: 'Docs',
        functions: [
          { name: 'search', description: 'Search documentation' },
          { name: 'read', description: 'Read a page' },
        ],
      },
    ],
  },
  discover: { tools: ['docs.search', 'search', 'docs'] },
  expected_discover_result: null,
  expected_discovered_tool_docs_subset: [
    {
      namespace: 'docs',
      name: 'search',
      qualified_name: 'docs.search',
      kind: 'tool',
      description: 'Search documentation',
    },
    {
      namespace: 'docs',
      name: 'read',
      qualified_name: 'docs.read',
      kind: 'tool',
      description: 'Read a page',
    },
  ],
  expected_policy_trace_subset: [
    { type: 'discover', tools: ['docs.search', 'search', 'docs'], skills: [] },
  ],
  expected_action_log_subset: [
    { type: 'discover', tools: ['docs.search', 'search', 'docs'], skills: [] },
  ],
});

writeFixture('discover-skills-host-results-dedupe', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    skillsMode: true,
    skill_search_results: {
      sql: [
        { id: 'skill.sql', name: 'sql', content: 'Use SELECT carefully.' },
        { id: 'skill.sql', name: 'sql', content: 'Duplicate should dedupe.' },
      ],
    },
  },
  discover: { skills: ['sql'] },
  expected_discover_result: null,
  expected_loaded_skill_docs_subset: [
    { id: 'skill.sql', name: 'sql', content: 'Use SELECT carefully.' },
  ],
  expected_policy_trace_subset: [
    { type: 'discover', tools: [], skills: ['sql'] },
  ],
});

writeFixture('discover-tools-requires-discovery-mode', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    functions: [{ name: 'search', description: 'Search docs' }],
  },
  discover: { tools: ['search'] },
  expected_error_contains:
    'discover({ tools }) requires function discovery to be enabled',
});

writeFixture('discover-skills-requires-skills-mode', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {},
  discover: { skills: ['sql'] },
  expected_error_contains:
    'discover({ skills }) requires skill discovery to be enabled',
});

writeFixture('recall-loads-memories', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    memoriesMode: true,
    memory_search_results: {
      'user prefs': [{ id: 'mem-1', content: 'User likes concise answers.' }],
    },
  },
  recall: 'user prefs',
  expected_recall_result: null,
  expected_loaded_memories_subset: [
    { id: 'mem-1', content: 'User likes concise answers.' },
  ],
  expected_policy_trace_subset: [{ type: 'recall', searches: ['user prefs'] }],
  expected_action_log_subset: [{ type: 'recall', searches: ['user prefs'] }],
});

writeFixture('recall-invalid-search-error', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    memoriesMode: true,
  },
  recall: [''],
  expected_error_contains: 'recall searches entries must be non-empty strings',
});

writeFixture('recall-requires-memory-mode', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {},
  recall: 'user prefs',
  expected_error_contains: 'recall(...) requires memory search to be enabled',
});

writeFixture('used-records-loaded-memory', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    memoriesMode: true,
    usageTrackingMode: true,
    memory_search_results: {
      prefs: [{ id: 'mem-1', content: 'User prefers examples.' }],
    },
  },
  recall: 'prefs',
  used: { id: 'mem-1', reason: 'answered from memory', stage: 'executor' },
  expected_used_result: null,
  expected_used_memories_subset: [
    {
      id: 'mem-1',
      reason: 'answered from memory',
      stage: 'executor',
    },
  ],
  expected_policy_trace_subset: [
    {
      type: 'used',
      id: 'mem-1',
      reason: 'answered from memory',
      matched: true,
    },
  ],
});

writeFixture('used-records-loaded-skill', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    skillsMode: true,
    usageTrackingMode: true,
    skill_search_results: {
      sql: [{ id: 'skill.sql', name: 'sql', content: 'Use SQL safely.' }],
    },
  },
  discover: { skills: ['sql'] },
  used: { id: 'skill.sql', reason: 'query planning', stage: 'executor' },
  expected_used_result: null,
  expected_used_skills_subset: [
    {
      id: 'skill.sql',
      name: 'sql',
      reason: 'query planning',
      stage: 'executor',
    },
  ],
});

writeFixture('used-unknown-id-is-ignored', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    memoriesMode: true,
    usageTrackingMode: true,
    memory_search_results: {
      prefs: [{ id: 'mem-1', content: 'Known memory.' }],
    },
  },
  recall: 'prefs',
  used: { id: 'missing', reason: 'not loaded', stage: 'executor' },
  expected_used_result: null,
  expected_exported_state_subset: {
    used_memories: [],
    used_skills: [],
  },
  expected_policy_trace_subset: [
    { type: 'used', id: 'missing', reason: 'not loaded', matched: false },
  ],
});

writeFixture('used-requires-usage-tracking', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {},
  used: { id: 'mem-1' },
  expected_error_contains: 'used(...) requires usage tracking to be enabled',
});

writeFixture('child-agent-call-executes-host-boundary', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    functions: [
      {
        namespace: 'agents',
        functions: [
          {
            name: 'researcher',
            kind: 'agent',
            description: 'Delegate research',
          },
        ],
      },
    ],
    callable_results: {
      'agents.researcher': { value: { answer: 'child result' } },
    },
  },
  invoke_callable: {
    qualified_name: 'agents.researcher',
    args: { question: 'Find docs' },
  },
  expected_callable_result_subset: {
    status: 'ok',
    value: { answer: 'child result' },
  },
  expected_function_call_traces_subset: [
    { qualified_name: 'agents.researcher', status: 'ok' },
  ],
  expected_action_log_subset: [
    {
      type: 'function_call',
      qualified_name: 'agents.researcher',
      status: 'ok',
    },
  ],
});

writeFixture('tool-call-guide-agent-protocol', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    functions: [
      {
        namespace: 'tools',
        functions: [{ name: 'review', description: 'Review plan' }],
      },
    ],
    callable_results: {
      'tools.review': {
        guidance: 'Use the approved template before answering.',
      },
    },
  },
  invoke_callable: {
    qualified_name: 'tools.review',
    args: { draft: 'rough answer' },
  },
  expected_callable_result_subset: {
    status: 'ok',
    guidance_payload: {
      type: 'guide_agent',
      guidance: 'Use the approved template before answering.',
      triggeredBy: 'tools.review',
    },
  },
  expected_guidance_log_subset: [
    {
      guidance: 'Use the approved template before answering.',
      triggeredBy: 'tools.review',
    },
  ],
  expected_action_log_subset: [
    {
      type: 'guide_agent',
      guidance: 'Use the approved template before answering.',
    },
  ],
  expected_trace_event_kinds: ['function_call', 'guide_agent'],
  replay_trace: true,
});

writeFixture('tool-call-error-records-trace', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    functions: [
      {
        namespace: 'tools',
        functions: [{ name: 'fail', description: 'Fails deterministically' }],
      },
    ],
    callable_results: {
      'tools.fail': { error: 'handler failed' },
    },
  },
  invoke_callable: {
    qualified_name: 'tools.fail',
    args: { input: 'x' },
  },
  expected_callable_result_subset: {
    status: 'error',
    error: 'handler failed',
  },
  expected_function_call_traces_subset: [
    { qualified_name: 'tools.fail', status: 'error' },
  ],
  expected_trace_event_kinds: ['function_call'],
  replay_trace: true,
});

writeFixture('trace-replay-discovery-recall-used', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    functionDiscovery: true,
    skillsMode: true,
    memoriesMode: true,
    usageTrackingMode: true,
    functions: [
      {
        namespace: 'docs',
        functions: [{ name: 'search', description: 'Search documentation' }],
      },
    ],
    skill_search_results: {
      sql: [{ id: 'skill.sql', name: 'sql', content: 'Use SQL safely.' }],
    },
    memory_search_results: {
      prefs: [{ id: 'mem-1', content: 'User prefers compact answers.' }],
    },
  },
  discover: { tools: ['docs'], skills: ['sql'] },
  recall: 'prefs',
  used: { id: 'mem-1', reason: 'personalization', stage: 'executor' },
  expected_discovered_tool_docs_subset: [
    { qualified_name: 'docs.search', description: 'Search documentation' },
  ],
  expected_loaded_skill_docs_subset: [
    { id: 'skill.sql', name: 'sql', content: 'Use SQL safely.' },
  ],
  expected_loaded_memories_subset: [
    { id: 'mem-1', content: 'User prefers compact answers.' },
  ],
  expected_used_memories_subset: [
    { id: 'mem-1', reason: 'personalization', stage: 'executor' },
  ],
  expected_trace_event_kinds: ['discover', 'recall', 'used'],
  replay_trace: true,
});

writeFixture('trace-replay-output-mismatch-error', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  replay_trace_input: {
    schema_version: 'axir-agent-trace-v1',
    kind: 'agent_run',
    status: 'completed',
    final_output: { answer: 'old' },
    events: [{ index: 0, kind: 'final', payload: { answer: 'old' } }],
  },
  replay_fixtures: {
    expected_event_kinds: ['final'],
    expected_output: { answer: 'new' },
  },
  expected_error_contains: 'agent replay output mismatch',
});

writeFixture('final-payload-normalization', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  final_payload: 'done',
  expected_final_payload: { type: 'final', args: ['done'] },
});

writeFixture('clarification-payload-normalization', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  clarification_payload: { question: 'Which city?', type: 'text' },
  expected_clarification_payload: {
    type: 'askClarification',
    args: [{ question: 'Which city?', type: 'text' }],
  },
});

writeFixture('runtime-state-export-restore', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  restore_runtime_state: {
    runtime_state: { session: 'restored' },
    discovered_tool_docs: [
      { namespace: 'docs', name: 'search', qualified_name: 'docs.search' },
    ],
    loaded_skill_docs: [{ name: 'sql', content: 'Skill docs loaded for sql' }],
    policy_trace: [{ type: 'discover', tools: ['docs'], skills: ['sql'] }],
  },
  expected_exported_state_subset: {
    runtime_state: { session: 'restored' },
    discovered_tool_docs: [
      { namespace: 'docs', name: 'search', qualified_name: 'docs.search' },
    ],
    loaded_skill_docs: [{ name: 'sql', content: 'Skill docs loaded for sql' }],
    policy_trace: [{ type: 'discover', tools: ['docs'], skills: ['sql'] }],
  },
});

writeFixture('optimizer-facing-metadata', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {},
  expected_optimizer_metadata_subset: {
    policy_version: 'agent-runtime-decision-v1',
    stage_ids: ['distiller', 'executor', 'responder'],
    optimizable_components: [
      {
        id: 'agent.actor.runtime_instructions',
        kind: 'runtime_instruction',
      },
      { id: 'agent.actor.discovery_policy', kind: 'policy' },
      { id: 'agent.actor.delegation_policy', kind: 'policy' },
      { id: 'agent.responder.signature', kind: 'stage' },
    ],
  },
});

writeFixture('runtime-test-fresh-session', {
  kind: 'agent_runtime_session',
  operation: 'test',
  signature: 'question:string -> answer:string',
  code: 'final({ answer: "ok" })',
  context_values: { question: 'hello' },
  runtime_script: [
    {
      expected_code: 'final({ answer: "ok" })',
      result: {
        type: 'final',
        args: [{ answer: 'ok' }],
        output: 'completed',
      },
    },
  ],
  expected_result_subset: {
    kind: 'final',
    completion_payload: { type: 'final', args: [{ answer: 'ok' }] },
  },
  expected_action_log_subset: [
    { action: 'create_session' },
    { kind: 'final' },
    { action: 'close_session' },
  ],
  expected_session_count: 1,
  expected_executed: ['final({ answer: "ok" })'],
});

writeFixture('runtime-session-persistent-bindings', {
  kind: 'agent_runtime_session',
  operation: 'steps',
  signature: 'question:string -> answer:string',
  context_values: { question: 'remember' },
  steps: [
    { code: 'scratch = inputs.question' },
    {
      code: 'final({ answer: scratch })',
      inspect: true,
      export_session_state: true,
    },
  ],
  runtime_script: [
    {
      expected_code: 'scratch = inputs.question',
      bindings_patch: { scratch: 'remember' },
      result: {
        kind: 'status',
        status: { type: 'success', message: 'stored scratch' },
      },
    },
    {
      expected_code: 'final({ answer: scratch })',
      result: { type: 'final', args: [{ answer: 'remember' }] },
    },
  ],
  expected_result_subset: {
    kind: 'final',
    completion_payload: { type: 'final', args: [{ answer: 'remember' }] },
  },
  expected_exported_state_subset: {
    runtime_session_state: { globals: { scratch: 'remember' }, closed: false },
  },
  expected_status_log_subset: [{ type: 'success', message: 'stored scratch' }],
  expected_session_count: 1,
  expected_executed: [
    'scratch = inputs.question',
    'final({ answer: scratch })',
  ],
});

writeFixture('runtime-reserved-name-protection', {
  kind: 'agent_runtime_session',
  operation: 'reserved',
  signature: 'question:string -> answer:string',
  code: 'inputs = 1',
  context_values: { inputs: 'bad' },
  runtime_script: [],
  expected_error_contains:
    'agent runtime global conflicts with reserved name: inputs',
});

writeFixture('runtime-inspect-export-restore', {
  kind: 'agent_runtime_session',
  operation: 'steps',
  signature: 'question:string -> answer:string',
  context_values: { question: 'state' },
  steps: [
    { code: 'counter = 1', inspect: true, export_session_state: true },
    {
      code: 'counter = restored',
      restore_session_state: {
        globals: { restored: true, counter: 9 },
        closed: false,
      },
      inspect: true,
      export_session_state: true,
    },
  ],
  runtime_script: [
    {
      expected_code: 'counter = 1',
      bindings_patch: { counter: 1 },
      result: {
        kind: 'status',
        status: { type: 'success', message: 'counter saved' },
      },
    },
    {
      expected_code: 'counter = restored',
      bindings_patch: { counter: 10 },
      result: {
        kind: 'status',
        status: { type: 'success', message: 'counter restored' },
      },
    },
  ],
  expected_exported_state_subset: {
    runtime_session_state: {
      globals: { restored: true, counter: 10 },
      closed: false,
    },
  },
  expected_status_log_subset: [
    { type: 'success', message: 'counter saved' },
    { type: 'success', message: 'counter restored' },
  ],
});

writeFixture('runtime-error-action-log', {
  kind: 'agent_runtime_session',
  operation: 'test',
  signature: 'question:string -> answer:string',
  code: 'raise Error("boom")',
  context_values: { question: 'fail' },
  runtime_script: [
    {
      expected_code: 'raise Error("boom")',
      result: {
        kind: 'error',
        is_error: true,
        error_category: 'runtime_error',
        error: 'boom',
      },
    },
  ],
  expected_result_subset: {
    kind: 'error',
    is_error: true,
    error_category: 'runtime_error',
    error: 'boom',
  },
  expected_action_log_subset: [
    { kind: 'error', error_category: 'runtime_error' },
  ],
  expected_trace_event_kinds: [
    'runtime_lifecycle',
    'runtime_execute',
    'error',
    'runtime_lifecycle',
  ],
  replay_trace: true,
});

writeFixture('trace-malformed-runtime-protocol', {
  kind: 'agent_runtime_session',
  operation: 'test',
  signature: 'question:string -> answer:string',
  code: 'return raw',
  context_values: { question: 'raw' },
  runtime_script: [
    {
      expected_code: 'return raw',
      result: 'not a protocol object',
    },
  ],
  expected_result_subset: {
    kind: 'result',
    result: 'not a protocol object',
  },
  expected_trace_event_kinds: [
    'runtime_lifecycle',
    'runtime_execute',
    'runtime_lifecycle',
  ],
  replay_trace: true,
});

writeFixture('runtime-session-closed-restart-notice', {
  kind: 'agent_runtime_session',
  operation: 'steps',
  signature: 'question:string -> answer:string',
  context_values: { question: 'restart' },
  close_runtime_session: true,
  steps: [{ code: 'final({ answer: "after restart" })' }],
  runtime_script: [
    {
      expected_code: 'final({ answer: "after restart" })',
      result: {
        kind: 'error',
        is_error: true,
        error_category: 'session_closed',
        error: 'session closed',
      },
    },
    {
      expected_code: 'final({ answer: "after restart" })',
      result: { type: 'final', args: [{ answer: 'after restart' }] },
    },
  ],
  expected_result_subset: {
    kind: 'final',
    completion_payload: { type: 'final', args: [{ answer: 'after restart' }] },
  },
  expected_action_log_subset: [
    { action: 'create_session' },
    { action: 'restart', reason: 'session_closed' },
    { action: 'create_session' },
    { kind: 'final' },
    { action: 'close_session' },
  ],
  expected_session_count: 2,
  expected_closed_session_count: 1,
  expected_trace_event_kinds: [
    'runtime_lifecycle',
    'runtime_lifecycle',
    'runtime_lifecycle',
    'runtime_execute',
    'final',
    'runtime_lifecycle',
  ],
});

writeFixture('runtime-session-closed-restart-once', {
  kind: 'agent_runtime_session',
  operation: 'test',
  signature: 'question:string -> answer:string',
  code: 'sessionClosed()',
  context_values: { question: 'restart once' },
  runtime_script: [
    {
      expected_code: 'sessionClosed()',
      result: {
        kind: 'error',
        is_error: true,
        error_category: 'session_closed',
        error: 'session closed first',
      },
    },
    {
      expected_code: 'sessionClosed()',
      result: {
        kind: 'error',
        is_error: true,
        error_category: 'session_closed',
        error: 'session closed again',
      },
    },
  ],
  expected_result_subset: {
    kind: 'error',
    is_error: true,
    error_category: 'session_closed',
    error: 'session closed again',
  },
  expected_action_log_subset: [
    { action: 'restart', reason: 'session_closed' },
    { kind: 'error', error_category: 'session_closed' },
    { action: 'close_session' },
  ],
  expected_session_count: 2,
  expected_closed_session_count: 1,
  expected_trace_event_kinds: [
    'runtime_lifecycle',
    'runtime_lifecycle',
    'runtime_lifecycle',
    'runtime_execute',
    'error',
    'runtime_lifecycle',
  ],
});

writeFixture('runtime-final-payload-normalization-session', {
  kind: 'agent_runtime_session',
  operation: 'test',
  signature: 'question:string -> answer:string',
  code: 'final("done")',
  context_values: { question: 'finish' },
  runtime_script: [
    {
      expected_code: 'final("done")',
      result: { completion_payload: { type: 'final', args: ['done'] } },
    },
  ],
  expected_result_subset: {
    kind: 'final',
    completion_payload: { type: 'final', args: ['done'] },
  },
});

writeFixture('runtime-clarification-payload-normalization-session', {
  kind: 'agent_runtime_session',
  operation: 'test',
  signature: 'question:string -> answer:string',
  code: 'askClarification({ question: "Which city?" })',
  context_values: { question: 'book it' },
  runtime_script: [
    {
      expected_code: 'askClarification({ question: "Which city?" })',
      result: {
        completion_payload: {
          type: 'askClarification',
          args: [{ question: 'Which city?' }],
        },
      },
    },
  ],
  expected_result_subset: {
    kind: 'askClarification',
    completion_payload: {
      type: 'askClarification',
      args: [{ question: 'Which city?' }],
    },
  },
  expected_trace_event_kinds: [
    'runtime_lifecycle',
    'runtime_execute',
    'clarification',
    'runtime_lifecycle',
  ],
  replay_trace: true,
});

writeFixture('runtime-discover-effect-next-prompt-state', {
  kind: 'agent_runtime_session',
  operation: 'test',
  signature: 'question:string -> answer:string',
  options: {
    functionDiscovery: true,
    skillsMode: true,
    functions: [
      {
        name: 'docs',
        namespace: 'docs',
        functions: [{ name: 'search', description: 'Search docs' }],
      },
    ],
  },
  code: 'discover({ tools: ["docs"], skills: ["sql"] })',
  context_values: { question: 'need tools' },
  runtime_script: [
    {
      expected_code: 'discover({ tools: ["docs"], skills: ["sql"] })',
      result: {
        kind: 'discover',
        discover: { tools: ['docs'], skills: ['sql'] },
      },
    },
  ],
  expected_action_log_subset: [{ kind: 'discover' }],
  expected_exported_state_subset: {
    discovered_tool_docs: [
      {
        namespace: 'docs',
        name: 'search',
        qualified_name: 'docs.search',
        kind: 'tool',
        description: 'Search docs',
      },
    ],
    loaded_skill_docs: [
      { id: 'sql', name: 'sql', content: 'Skill docs loaded for sql' },
    ],
  },
});

writeFixture('runtime-status-records', {
  kind: 'agent_runtime_session',
  operation: 'test',
  signature: 'question:string -> answer:string',
  code: 'reportSuccess("loaded")',
  context_values: { question: 'status' },
  runtime_script: [
    {
      expected_code: 'reportSuccess("loaded")',
      result: {
        kind: 'status',
        status: { type: 'success', message: 'loaded' },
      },
    },
  ],
  expected_result_subset: {
    kind: 'status',
    status: { type: 'success', message: 'loaded' },
  },
  expected_status_log_subset: [{ type: 'success', message: 'loaded' }],
});

writeFixture('runtime-host-boundary-globals-options', {
  kind: 'agent_runtime_session',
  operation: 'test',
  signature: 'question:string, user:string -> answer:string',
  code: 'final({ answer: inputs.question })',
  context_values: { question: 'hello', user: 'Ada' },
  runtime_options: {
    traceId: 'runtime-trace-1',
    sessionId: 'session-from-options',
    timeout: 1234,
    abort: true,
  },
  runtime_script: [
    {
      expected_code: 'final({ answer: inputs.question })',
      expected_options_subset: {
        traceId: 'runtime-trace-1',
        sessionId: 'session-from-options',
        timeout: 1234,
        abort: true,
        reservedNames: [
          'inputs',
          'final',
          'askClarification',
          'discover',
          'recall',
          'llmQuery',
          'inspectRuntime',
          'reportSuccess',
          'reportFailure',
        ],
      },
      result: { type: 'final', args: [{ answer: 'hello' }] },
    },
  ],
  expected_result_subset: {
    kind: 'final',
    completion_payload: { type: 'final', args: [{ answer: 'hello' }] },
  },
  expected_create_globals_subset: {
    inputs: { question: 'hello', user: 'Ada' },
    context: { question: 'hello', user: 'Ada' },
    question: 'hello',
    user: 'Ada',
  },
  expected_create_options_subset: {
    traceId: 'runtime-trace-1',
    sessionId: 'session-from-options',
    timeout: 1234,
    abort: true,
    reservedNames: [
      'inputs',
      'final',
      'askClarification',
      'discover',
      'recall',
      'llmQuery',
      'inspectRuntime',
      'reportSuccess',
      'reportFailure',
    ],
  },
  expected_execute_options_subset: {
    traceId: 'runtime-trace-1',
    sessionId: 'session-from-options',
    timeout: 1234,
    abort: true,
    reservedNames: [
      'inputs',
      'final',
      'askClarification',
      'discover',
      'recall',
      'llmQuery',
      'inspectRuntime',
      'reportSuccess',
      'reportFailure',
    ],
  },
});

writeFixture('runtime-snapshot-sanitizes-reserved-globals', {
  kind: 'agent_runtime_session',
  operation: 'steps',
  signature: 'question:string -> answer:string',
  context_values: { question: 'sanitize' },
  steps: [{ code: 'save reserved', export_session_state: true }],
  runtime_script: [
    {
      expected_code: 'save reserved',
      bindings_patch: {
        safeValue: 'kept',
        inputs: 'must not persist',
        final: 'must not persist',
      },
      result: { kind: 'status', status: { type: 'success', message: 'saved' } },
    },
  ],
  expected_exported_state_subset: {
    runtime_session_state: { globals: { safeValue: 'kept' } },
  },
  expected_absent_runtime_session_globals: ['inputs', 'final'],
  expected_action_log_subset: [{ action: 'snapshot_globals' }],
});

writeFixture('runtime-invalid-snapshot-rejected', {
  kind: 'agent_runtime_session',
  operation: 'steps',
  signature: 'question:string -> answer:string',
  context_values: { question: 'bad restore' },
  steps: [
    { code: 'first' },
    {
      code: 'after bad restore',
      restore_session_state: { globals: 'not an object' },
    },
  ],
  runtime_script: [
    {
      expected_code: 'first',
      result: {
        kind: 'status',
        status: { type: 'success', message: 'started' },
      },
    },
  ],
  expected_error_contains: 'runtime session snapshot globals must be an object',
});

writeFixture('runtime-missing-snapshot-capability', {
  kind: 'agent_runtime_session',
  operation: 'steps',
  signature: 'question:string -> answer:string',
  context_values: { question: 'missing snapshot' },
  runtime_capabilities: { snapshot: false },
  steps: [{ code: 'state = 1', export_session_state: true }],
  runtime_script: [
    {
      expected_code: 'state = 1',
      result: {
        kind: 'status',
        status: { type: 'success', message: 'state saved' },
      },
    },
  ],
  expected_error_contains: 'required to export AxAgent state',
});

writeFixture('runtime-missing-patch-capability', {
  kind: 'agent_runtime_session',
  operation: 'steps',
  signature: 'question:string -> answer:string',
  context_values: { question: 'missing patch' },
  runtime_capabilities: { patch: false },
  steps: [
    { code: 'state = 1' },
    {
      code: 'state = 2',
      restore_session_state: { globals: { restored: true }, closed: false },
    },
  ],
  runtime_script: [
    {
      expected_code: 'state = 1',
      result: {
        kind: 'status',
        status: { type: 'success', message: 'state saved' },
      },
    },
  ],
  expected_error_contains: 'required to restore AxAgent state',
});

writeFixture('runtime-inspect-unavailable-non-js-boundary', {
  kind: 'agent_runtime_session',
  operation: 'steps',
  signature: 'question:string -> answer:string',
  context_values: { question: 'inspect' },
  runtime_capabilities: { inspect: false },
  steps: [{ code: 'x = 1', inspect: true }],
  runtime_script: [
    {
      expected_code: 'x = 1',
      result: { kind: 'status', status: { type: 'success', message: 'ran' } },
    },
  ],
  expected_runtime_inspection_contains: 'runtime state inspection unavailable',
  expected_action_log_subset: [{ action: 'inspect_globals' }],
});

writeFixture('runtime-timeout-error-is-logged', {
  kind: 'agent_runtime_session',
  operation: 'test',
  signature: 'question:string -> answer:string',
  code: 'while true',
  context_values: { question: 'timeout' },
  runtime_script: [
    {
      expected_code: 'while true',
      result: {
        kind: 'error',
        is_error: true,
        error_category: 'timeout',
        error: 'execution timed out',
      },
    },
  ],
  expected_result_subset: {
    kind: 'error',
    is_error: true,
    error_category: 'timeout',
    error: 'execution timed out',
  },
  expected_action_log_subset: [{ kind: 'error', error_category: 'timeout' }],
  expected_trace_event_kinds: [
    'runtime_lifecycle',
    'runtime_execute',
    'error',
    'runtime_lifecycle',
  ],
  expected_closed_session_count: 1,
});

writeFixture('runtime-host-abort-escapes', {
  kind: 'agent_runtime_session',
  operation: 'test',
  signature: 'question:string -> answer:string',
  code: 'abort()',
  context_values: { question: 'abort' },
  runtime_script: [
    {
      expected_code: 'abort()',
      result: {
        kind: 'error',
        is_error: true,
        error_category: 'abort',
        error: 'Aborted',
      },
    },
  ],
  expected_error_contains: 'runtime host boundary escaped abort',
  expected_closed_session_count: 1,
});

writeFixture('runtime-adapter-helper-envelopes', {
  kind: 'agent_runtime_adapter',
  signature: 'question:string -> answer:string',
  capabilities: {
    inspect: false,
    snapshot: true,
    patch: false,
    abort: true,
    language: 'Python',
    usage_instructions: 'Use safe globals only.',
  },
  expected_capabilities: {
    inspect: false,
    snapshot: true,
    patch: false,
    abort: true,
    language: 'Python',
    usage_instructions: 'Use safe globals only.',
  },
  helper_calls: [
    {
      name: 'result',
      args: [{ answer: 'ok' }],
      expected: { kind: 'result', result: { answer: 'ok' } },
      normalize: true,
      expected_normalized_subset: { kind: 'result', result: { answer: 'ok' } },
    },
    {
      name: 'error',
      args: ['boom', 'runtime'],
      expected_subset: {
        kind: 'error',
        is_error: true,
        error_category: 'runtime',
        error: 'boom',
      },
      normalize: true,
      expected_normalized_subset: {
        kind: 'error',
        is_error: true,
        error_category: 'runtime',
      },
    },
    {
      name: 'session_closed',
      args: ['closed'],
      expected_subset: {
        kind: 'error',
        is_error: true,
        error_category: 'session_closed',
        error: 'closed',
      },
      normalize: true,
      expected_normalized_subset: {
        kind: 'error',
        restart_notice: 'runtime session closed; restarting fresh session',
      },
    },
    {
      name: 'timeout',
      args: ['slow'],
      expected_subset: {
        kind: 'error',
        is_error: true,
        error_category: 'timeout',
        error: 'slow',
      },
      normalize: true,
      expected_normalized_subset: { kind: 'error', error_category: 'timeout' },
    },
    {
      name: 'final',
      args: [{ answer: 'ok' }],
      expected: { type: 'final', args: [{ answer: 'ok' }] },
      normalize: true,
      expected_normalized_subset: {
        kind: 'final',
        completion_payload: { type: 'final', args: [{ answer: 'ok' }] },
      },
    },
    {
      name: 'ask_clarification',
      args: [{ question: 'Which one?' }],
      expected: {
        type: 'askClarification',
        args: [{ question: 'Which one?' }],
      },
      normalize: true,
      expected_normalized_subset: {
        kind: 'askClarification',
        completion_payload: {
          type: 'askClarification',
          args: [{ question: 'Which one?' }],
        },
      },
    },
    {
      name: 'discover',
      args: [{ tools: ['docs'] }],
      expected: { kind: 'discover', discover: { tools: ['docs'] } },
    },
    {
      name: 'recall',
      args: ['prefs'],
      expected: { kind: 'recall', recall: 'prefs' },
    },
    {
      name: 'used',
      args: ['mem-1'],
      kwargs: { reason: 'relevant', stage: 'executor' },
      expected: {
        kind: 'used',
        used: { id: 'mem-1', reason: 'relevant', stage: 'executor' },
      },
    },
    {
      name: 'status',
      args: ['success', 'loaded'],
      expected: {
        kind: 'status',
        status: { type: 'success', message: 'loaded' },
      },
    },
    {
      name: 'guide_agent',
      args: ['Use the loaded docs.', 'tools.review'],
      expected: {
        type: 'guide_agent',
        guidance: 'Use the loaded docs.',
        triggeredBy: 'tools.review',
      },
      normalize: true,
      expected_normalized_subset: {
        kind: 'guide_agent',
        guidance_payload: {
          type: 'guide_agent',
          guidance: 'Use the loaded docs.',
          triggeredBy: 'tools.review',
        },
      },
    },
  ],
});

writeFixture('runtime-adapter-final-session', {
  kind: 'agent_runtime_adapter',
  signature: 'question:string -> answer:string',
  context_values: { question: 'adapter' },
  run_session: {
    name: 'final',
    args: [{ answer: 'adapter ok' }],
  },
  expected_result_subset: {
    kind: 'final',
    completion_payload: { type: 'final', args: [{ answer: 'adapter ok' }] },
  },
  expected_action_log_subset: [
    { action: 'create_session' },
    { kind: 'final' },
    { action: 'close_session' },
  ],
  expected_closed_session_count: 1,
  expected_trace_event_kinds: [
    'runtime_lifecycle',
    'runtime_execute',
    'final',
    'runtime_lifecycle',
  ],
});

writeFixture('runtime-protocol-roundtrip', {
  kind: 'agent_runtime_protocol',
  operation: 'roundtrip',
  create_globals: {
    inputs: {
      question: 'adapter',
    },
  },
  create_options: {
    reservedNames: ['inputs', 'final'],
    timeoutMs: 123,
  },
  execute_code: 'final()',
  execute_options: {
    timeout: 7,
    abort: true,
    sessionId: 'runtime-protocol-session',
    traceId: 'runtime-protocol-trace',
  },
  patch_globals: {
    bindings: {
      answer: 'patched',
      safe: true,
    },
  },
  expected_capabilities_subset: {
    language: 'JavaScript',
    usage_instructions: 'fixture protocol runtime',
    inspect: true,
    snapshot: true,
    patch: true,
    abort: true,
  },
  expected_execute_subset: {
    type: 'final',
    args: [
      {
        answer: 'fixture',
      },
    ],
  },
  expected_inspect_subset: {
    inputs: {
      question: 'adapter',
    },
    __create_options: {
      reservedNames: ['inputs', 'final'],
      timeoutMs: 123,
    },
    __last_execute_options: {
      timeout: 7,
      abort: true,
      sessionId: 'runtime-protocol-session',
      traceId: 'runtime-protocol-trace',
    },
    answer: 'fixture',
  },
  expected_snapshot_subset: {
    bindings: {
      answer: 'fixture',
    },
  },
  expected_patch_subset: {
    bindings: {
      answer: 'patched',
      safe: true,
    },
  },
  expected_close_subset: {
    closed: true,
  },
});

writeFixture('runtime-protocol-timeout-error', {
  kind: 'agent_runtime_protocol',
  operation: 'execute_error',
  execute_code: 'timeout()',
  expected_execute_subset: {
    kind: 'error',
    is_error: true,
    error_category: 'timeout',
    error: 'fixture timeout',
  },
});

writeFixture('runtime-protocol-unavailable-inspect', {
  kind: 'agent_runtime_protocol',
  operation: 'unavailable',
  mode: 'unavailable',
  method: 'inspect_globals',
  expected_error_contains: 'inspectGlobals unavailable',
});

writeFixture('runtime-protocol-id-mismatch', {
  kind: 'agent_runtime_protocol',
  operation: 'capabilities_error',
  mode: 'id_mismatch',
  expected_error_contains: 'response id mismatch',
});

writeFixture('runtime-protocol-session-mismatch', {
  kind: 'agent_runtime_protocol',
  operation: 'session_mismatch',
  mode: 'session_mismatch',
  expected_error_contains: 'session_id mismatch',
});

writeFixture('runtime-protocol-malformed-response', {
  kind: 'agent_runtime_protocol',
  operation: 'capabilities_error',
  mode: 'malformed_json',
  expected_error_contains: 'runtime protocol',
});

writeFixture('runtime-protocol-unknown-op', {
  kind: 'agent_runtime_protocol',
  operation: 'unknown_op',
  expected_error_contains: 'unknown runtime protocol op',
});

writeFixture('runtime-protocol-eof-error', {
  kind: 'agent_runtime_protocol',
  operation: 'capabilities_error',
  mode: 'eof',
  expected_error_contains: 'closed without a response',
});

writeFixture('runtime-protocol-nonzero-stderr-error', {
  kind: 'agent_runtime_protocol',
  operation: 'capabilities_error',
  mode: 'nonzero',
  expected_error_contains: 'exit code 7',
});
