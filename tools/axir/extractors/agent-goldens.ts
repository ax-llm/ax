import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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

mkdirSync(outDir, { recursive: true });
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
    language: 'javascript',
    code_field_name: 'javascriptCode',
    code_field_title: 'Javascript Code',
    code_fence_language: 'javascript',
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
    language: 'python',
    code_field_name: 'pythonCode',
    code_fence_language: 'python',
    usage_instructions:
      'Use pythonCode to call tools through namespaced runtime functions.',
  },
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
  options: {},
  discover: { skills: ['sql'] },
  expected_discover_result: null,
  expected_loaded_skill_docs_subset: [
    { name: 'sql', content: 'Skill docs loaded for sql' },
  ],
  expected_policy_trace_subset: [
    { type: 'discover', tools: [], skills: ['sql'] },
  ],
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
});

writeFixture('runtime-session-closed-restart-notice', {
  kind: 'agent_runtime_session',
  operation: 'steps',
  signature: 'question:string -> answer:string',
  context_values: { question: 'restart' },
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
  ],
  expected_session_count: 2,
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
});

writeFixture('runtime-discover-effect-next-prompt-state', {
  kind: 'agent_runtime_session',
  operation: 'test',
  signature: 'question:string -> answer:string',
  options: {
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
    loaded_skill_docs: [{ name: 'sql', content: 'Skill docs loaded for sql' }],
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
