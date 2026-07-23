import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// cspell:ignore kwargs needleafterlimit replayable
import {
  AX_HOST_SNIPPET_MARKER,
  AX_INPUTS_PATCH_GLOBAL,
} from '../../../src/ax/agent/agentInternal/sharedSession.js';
import {
  computeEffectiveChatBudget,
  resolveContextPolicy,
  resolveExecutorModelPolicy,
  selectActorModelFromPolicy,
} from '../../../src/ax/agent/config.js';
import {
  classifyContextPressure,
  renderContextPressure,
} from '../../../src/ax/agent/contextEvents.js';
import {
  type ActionLogEntry,
  buildActionLogParts,
  buildRuntimeStateProvenance,
  extractWorkingCodeState,
  manageContext,
} from '../../../src/ax/agent/contextManager.js';
import { agent } from '../../../src/ax/agent/index.js';
import type { AxCodeRuntime } from '../../../src/ax/agent/rlm.js';
import { getRuntimeLanguageInfo } from '../../../src/ax/agent/rlm.js';
import { formatStructuredRuntimeState } from '../../../src/ax/agent/runtime.js';
import { visibleRuntimePrimitives } from '../../../src/ax/agent/runtimePrimitives.js';
import {
  computeDynamicRuntimeChars,
  smartStringify,
} from '../../../src/ax/agent/truncate.js';
import { AxMockAIService } from '../../../src/ax/ai/mock/api.js';
import { AxSignature } from '../../../src/ax/dsp/sig.js';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Fixture = Record<string, Json>;

const outRoot = process.env.AXIR_CONFORMANCE_OUT_ROOT ?? process.cwd();
const outDir = join(outRoot, 'ir/conformance/axagent');
const parityContractsOnly = process.env.AXIR_AGENT_PARITY_ONLY === '1';

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
  if (
    parityContractsOnly &&
    typeof fixture.parity_contract_id !== 'string' &&
    !Array.isArray(fixture.parity_contract_ids)
  ) {
    return;
  }
  writeFileSync(
    join(outDir, `${name}.json`),
    `${JSON.stringify(stable({ name, ...fixture }), null, 2)}\n`
  );
}

function oracleModelUsage() {
  return {
    ai: 'oracle-ai',
    model: 'oracle-model',
    tokens: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  };
}

function oraclePromptText(content: unknown): string {
  return typeof content === 'string' ? content : JSON.stringify(content ?? '');
}

const SEMANTIC_PROMPT_FIELD_LABELS = [
  'Query',
  'Executor Request',
  'Distilled Context Summary',
  'Context Metadata',
  'Context Map',
  'Discovered Tool Docs',
  'Loaded Skills',
  'Memories',
  'Relevance Hints',
  'Summarized Actor Log',
  'Guidance Log',
  'Action Log',
  'Live Runtime State',
  'Context Pressure',
] as const;

function normalizeSemanticPromptText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

function semanticPromptField(user: string, label: string): string {
  const normalized = normalizeSemanticPromptText(user);
  const marker = `${label}: `;
  const start = normalized.indexOf(marker);
  if (start < 0) return '';
  const bodyStart = start + marker.length;
  let end = normalized.length;
  for (const candidate of SEMANTIC_PROMPT_FIELD_LABELS) {
    if (candidate === label) continue;
    const next = normalized.indexOf(`\n\n${candidate}: `, bodyStart);
    if (next >= 0 && next < end) end = next;
  }
  return normalizeSemanticPromptText(
    `${label}: ${normalized.slice(bodyStart, end)}`
  );
}

function semanticAvailableSkillsIndex(system: string): string {
  const normalized = normalizeSemanticPromptText(system);
  const heading = '### Available Skills';
  const start = normalized.indexOf(heading);
  if (start < 0) return '';
  const lines = normalized.slice(start + heading.length).split('\n');
  const entries: string[] = [];
  for (const line of lines) {
    if (line.trim() === '' && entries.length === 0) continue;
    if (!line.startsWith('- `')) break;
    entries.push(line);
  }
  if (entries.length === 0) return '';
  return `${heading}\n\n${entries.join('\n')}`;
}

function semanticStageRequests(
  requests: ReadonlyArray<{ stage: string; system: string; user: string }>
): Json {
  return requests.map(({ stage, system, user }) => ({
    stage,
    availableSkills: semanticAvailableSkillsIndex(system),
    loadedSkills: semanticPromptField(user, 'Loaded Skills'),
    memories: semanticPromptField(user, 'Memories'),
    relevanceHints: semanticPromptField(user, 'Relevance Hints'),
  })) as Json;
}

function semanticParityRuntime(projection: {
  loadedMemories?: unknown;
}): AxCodeRuntime {
  return {
    getUsageInstructions: () => '',
    createSession(globals) {
      return {
        async execute(code: string) {
          const inputs = globals?.inputs as Record<string, unknown> | undefined;
          if (Array.isArray(inputs?.memories)) {
            projection.loadedMemories = structuredClone(inputs.memories);
          }
          if (code.startsWith(AX_HOST_SNIPPET_MARKER)) return 'host-snippet';
          if (code.includes('discover(')) {
            await (globals?.discover as (request: unknown) => Promise<void>)({
              skills: ['release'],
            });
            return 'discovered';
          }
          if (code.includes('recall(')) {
            await (globals?.recall as (request: unknown) => Promise<void>)([
              'deploy',
            ]);
            return 'recalled';
          }
          if (code.includes('used("shared"')) {
            (globals?.used as (id: string, reason: string) => void)(
              'shared',
              'forward override used'
            );
            return 'used skill';
          }
          if (code.includes('used("mem-a"')) {
            (globals?.used as (id: string, reason: string) => void)(
              'mem-a',
              'preload then recall override used'
            );
            return 'used memory';
          }
          if (globals?.final && code.includes('final(')) {
            (globals.final as (...args: unknown[]) => void)('done', {
              answer: 'oracle',
            });
            return 'done';
          }
          return 'ok';
        },
        async patchGlobals(patch: Record<string, unknown>) {
          const { [AX_INPUTS_PATCH_GLOBAL]: staged, ...rest } = patch;
          Object.assign(globals ?? {}, rest);
          if (globals && staged && typeof staged === 'object') {
            globals.inputs = Object.assign(
              (globals.inputs as Record<string, unknown>) ?? {},
              staged
            );
          }
        },
        inspectGlobals() {
          return JSON.stringify({ entries: [] });
        },
        snapshotGlobals() {
          return {
            version: 1,
            entries: [],
            bindings: {},
          };
        },
        close() {},
      };
    },
  };
}

function semanticDirectResponseRuntime(): AxCodeRuntime {
  return {
    getUsageInstructions: () => '',
    createSession(globals) {
      return {
        async execute(code: string) {
          if (code.startsWith(AX_HOST_SNIPPET_MARKER)) return 'host-snippet';
          if (globals?.respond && code.includes('respond(')) {
            (globals.respond as (...args: unknown[]) => void)('direct', {
              source: 'forward-skill',
            });
            return 'responded';
          }
          return 'ok';
        },
        async patchGlobals(patch: Record<string, unknown>) {
          const { [AX_INPUTS_PATCH_GLOBAL]: staged, ...rest } = patch;
          Object.assign(globals ?? {}, rest);
          if (globals && staged && typeof staged === 'object') {
            globals.inputs = Object.assign(
              (globals.inputs as Record<string, unknown>) ?? {},
              staged
            );
          }
        },
        inspectGlobals() {
          return JSON.stringify({ entries: [] });
        },
        snapshotGlobals() {
          return { version: 1, entries: [], bindings: {} };
        },
        close() {},
      };
    },
  };
}

function semanticSequenceRuntime(): AxCodeRuntime {
  return {
    getUsageInstructions: () => '',
    createSession(globals) {
      return {
        async execute(code: string) {
          if (code.startsWith(AX_HOST_SNIPPET_MARKER)) return 'host-snippet';
          if (!globals?.final || !code.includes('final(')) return 'ok';
          const finish = globals.final as (...args: unknown[]) => void;
          const execute = code.match(/execute-([a-z0-9-]+)/)?.[1];
          const answer = code.match(/answer-([a-z0-9-]+)/)?.[1];
          if (execute) finish(`execute-${execute}`, {});
          else if (answer) finish(`answer-${answer}`, { answer });
          return 'done';
        },
        async patchGlobals(patch: Record<string, unknown>) {
          const { [AX_INPUTS_PATCH_GLOBAL]: staged, ...rest } = patch;
          Object.assign(globals ?? {}, rest);
          if (globals && staged && typeof staged === 'object') {
            globals.inputs = Object.assign(
              (globals.inputs as Record<string, unknown>) ?? {},
              staged
            );
          }
        },
        inspectGlobals() {
          return JSON.stringify({ entries: [] });
        },
        snapshotGlobals() {
          return { version: 1, entries: [], bindings: {} };
        },
        close() {},
      };
    },
  };
}

function semanticCatalogRuntime(): AxCodeRuntime {
  return {
    getUsageInstructions: () => '',
    createSession(globals) {
      return {
        async execute(code: string) {
          if (code.startsWith(AX_HOST_SNIPPET_MARKER)) return 'host-snippet';
          if (code.includes('discover-invoice')) {
            await (globals?.discover as (request: unknown) => Promise<void>)({
              skills: ['invoice status'],
            });
            return 'discovered invoice';
          }
          if (code.includes('recall-deploy')) {
            await (globals?.recall as (request: unknown) => Promise<void>)([
              'deploy release',
            ]);
            return 'recalled deploy';
          }
          if (code.includes('discover-limit')) {
            await (globals?.discover as (request: unknown) => Promise<void>)({
              skills: ['needleafterlimit'],
            });
            return 'checked skill limit';
          }
          if (code.includes('recall-limit')) {
            await (globals?.recall as (request: unknown) => Promise<void>)([
              'needleafterlimit',
            ]);
            return 'checked memory limit';
          }
          if (globals?.final && code.includes('final(')) {
            (globals.final as (...args: unknown[]) => void)('catalog done', {
              answer: 'catalog',
            });
            return 'done';
          }
          return 'ok';
        },
        async patchGlobals(patch: Record<string, unknown>) {
          const { [AX_INPUTS_PATCH_GLOBAL]: staged, ...rest } = patch;
          Object.assign(globals ?? {}, rest);
          if (globals && staged && typeof staged === 'object') {
            globals.inputs = Object.assign(
              (globals.inputs as Record<string, unknown>) ?? {},
              staged
            );
          }
        },
        inspectGlobals() {
          return JSON.stringify({ entries: [] });
        },
        snapshotGlobals() {
          return { version: 1, entries: [], bindings: {} };
        },
        close() {},
      };
    },
  };
}

async function writeSemanticParityLifecycleOracle(): Promise<void> {
  const observerTranscript: Array<{ callback: string; payload: unknown }> = [];
  const runtimeProjection: { loadedMemories?: unknown } = {};
  const requestTranscript: Array<{
    stage: string;
    system: string;
    user: string;
  }> = [];
  const alreadyLoadedTranscript: unknown[] = [];
  let executorTurn = 0;
  const executorCode = [
    'discover({"skills":["release"]})',
    'recall(["deploy"])',
    'used("shared", "forward override used")',
    'used("mem-a", "preload then recall override used")',
    'final("done", {"answer":"oracle"})',
  ];
  const ai = new AxMockAIService({
    features: { functions: false, streaming: false },
    chatResponse: async (request) => {
      const system = oraclePromptText(request.chatPrompt[0]?.content);
      const user = oraclePromptText(request.chatPrompt[1]?.content);
      if (system.includes('You (`distiller`)')) {
        requestTranscript.push({ stage: 'distiller', system, user });
        return {
          results: [
            {
              index: 0,
              content: 'Javascript Code: final("execute", {"context":"ready"})',
              finishReason: 'stop' as const,
            },
          ],
          modelUsage: oracleModelUsage(),
        };
      }
      if (system.includes('You (`executor`)')) {
        requestTranscript.push({ stage: 'executor', system, user });
        const code = executorCode[executorTurn++] ?? executorCode.at(-1)!;
        return {
          results: [
            {
              index: 0,
              content: `Javascript Code: ${code}`,
              finishReason: 'stop' as const,
            },
          ],
          modelUsage: oracleModelUsage(),
        };
      }
      requestTranscript.push({ stage: 'responder', system, user });
      return {
        results: [
          {
            index: 0,
            content: 'Answer: oracle',
            finishReason: 'stop' as const,
          },
        ],
        modelUsage: oracleModelUsage(),
      };
    },
  });

  const constructorUsedMemories = (payload: unknown) =>
    observerTranscript.push({ callback: 'constructor.used_memories', payload });
  const constructorUsedSkills = (payload: unknown) =>
    observerTranscript.push({ callback: 'constructor.used_skills', payload });
  const forwardUsedMemories = (payload: unknown) =>
    observerTranscript.push({ callback: 'forward.used_memories', payload });
  const forwardUsedSkills = (payload: unknown) =>
    observerTranscript.push({ callback: 'forward.used_skills', payload });

  const oracle = agent('query:string -> answer:string', {
    ai,
    runtime: semanticParityRuntime(runtimeProjection),
    directResponse: 'off',
    maxTurns: 8,
    relevanceRanking: { topK: 2, minScore: 0 },
    skills: [
      { id: ' shared ', name: 'Constructor shared', content: 'old skill' },
      { name: ' empty-skill ', content: '' },
      { id: '', name: '', content: 'malformed' },
    ],
    skillsCatalog: [
      {
        id: 'catalog-release',
        name: 'Catalog release',
        description: 'release checklist',
        content: 'CATALOG SKILL MUST NOT WIN HOST PRECEDENCE',
      },
      {
        id: 'catalog-incident',
        name: 'Catalog incident',
        description: 'incident response',
        content: 'catalog incident body',
      },
    ],
    memoriesCatalog: [
      {
        id: 'catalog-deploy',
        content: 'CATALOG MEMORY MUST NOT WIN HOST PRECEDENCE',
      },
      { id: 'catalog-coffee', content: 'catalog coffee body' },
    ],
    onSkillsSearch: async () => [
      { id: 'host-release', name: 'Host release', content: 'HOST SKILL' },
    ],
    onMemoriesSearch: async (_searches, alreadyLoaded) => {
      alreadyLoadedTranscript.push(alreadyLoaded);
      return [
        { id: 'mem-a', content: 'HOST MEMORY OVERRIDE' },
        { id: 'host-memory', content: 'HOST MEMORY' },
      ];
    },
    onLoadedSkills: (payload) => {
      observerTranscript.push({ callback: 'loaded_skills', payload });
      throw new Error('observer errors are ignored');
    },
    onLoadedMemories: async (payload) => {
      observerTranscript.push({ callback: 'loaded_memories', payload });
      throw new Error('observer errors are ignored');
    },
    onUsedMemories: constructorUsedMemories,
    onUsedSkills: constructorUsedSkills,
  });

  const output = await oracle.forward(
    ai,
    {
      query: 'prepare the release deploy',
      memories: [
        { id: ' mem-a ', content: 'PRELOADED MEMORY' },
        { id: 'z-memory', content: '' },
        { id: '', content: 'malformed' },
      ],
    } as never,
    {
      skills: [
        { id: 'shared', name: 'Forward shared', content: 'FORWARD SKILL' },
        { id: 'forward-only', name: 'Forward only', content: '' },
      ],
      onUsedMemories: forwardUsedMemories,
      onUsedSkills: forwardUsedSkills,
    }
  );

  const state = oracle.getState();
  const loadedSkills = state?.skillsPromptState?.loaded ?? [];
  const finalExecutorUser =
    [...requestTranscript].reverse().find((entry) => entry.stage === 'executor')
      ?.user ?? '';
  const loadedMemories = [
    ...finalExecutorUser.matchAll(
      /### Memory\n\nID: `([^`]+)`\n\n([\s\S]*?)(?=\n\n### Memory|\n\n[A-Z][A-Za-z ]+:|$)/g
    ),
  ].map((match) => ({ id: match[1]!, content: match[2]!.trim() })) as Json;
  const usedSkills = (observerTranscript.find(
    (entry) => entry.callback === 'forward.used_skills'
  )?.payload ?? []) as Json;
  const usedMemories = (observerTranscript.find(
    (entry) => entry.callback === 'forward.used_memories'
  )?.payload ?? []) as Json;
  const stageRequests = semanticStageRequests(requestTranscript);
  const exactProjection = {
    output,
    stageRequests,
    loadedSkills,
    loadedMemories,
    usedSkills,
    usedMemories,
    alreadyLoaded: alreadyLoadedTranscript,
    observerTranscript,
    errors: [],
  };
  const contractIDs = [
    'axagent.constructor.skills',
    'axagent.constructor.skillsCatalog',
    'axagent.constructor.memoriesCatalog',
    'axagent.constructor.relevanceRanking',
    'axagent.constructor.onSkillsSearch',
    'axagent.constructor.onMemoriesSearch',
    'axagent.constructor.onLoadedSkills',
    'axagent.constructor.onLoadedMemories',
    'axagent.constructor.onUsedSkills',
    'axagent.constructor.onUsedMemories',
    'axagent.constructor.directResponse',
    'axagent.forward.skills',
    'axagent.forward.onUsedSkills',
    'axagent.forward.onUsedMemories',
    'axagent.method.forward',
    'axagent.method.getState',
    'axagent.method.setState',
    'axagent.state.skillsPromptState',
  ];
  writeFixture('semantic-parity-lifecycle-oracle', {
    parity_contract_ids: contractIDs,
    exact_observable_projection: exactProjection as Json,
    option_effect:
      'Removing any enrolled option changes loaded prompt state, ranking/search precedence, callback transcript, used-state consolidation, or exported/restored skill state.',
    option_effects: {
      'axagent.constructor.skills': 'loadedSkills',
      'axagent.constructor.skillsCatalog': 'stageRequests',
      'axagent.constructor.onSkillsSearch': 'loadedSkills',
      'axagent.constructor.onMemoriesSearch': 'loadedMemories',
      'axagent.constructor.onLoadedSkills': 'observerTranscript',
      'axagent.constructor.onLoadedMemories': 'observerTranscript',
      'axagent.constructor.onUsedSkills': 'observerTranscript',
      'axagent.constructor.onUsedMemories': 'observerTranscript',
      'axagent.forward.skills': 'loadedSkills',
      'axagent.forward.onUsedSkills': 'observerTranscript',
      'axagent.forward.onUsedMemories': 'observerTranscript',
      'axagent.method.forward': 'output',
      'axagent.method.getState': 'loadedSkills',
      'axagent.state.skillsPromptState': 'loadedSkills',
    },
    kind: 'agent_forward',
    signature: 'query:string -> answer:string',
    options: {
      runtime: { language: 'JavaScript' },
      directResponse: 'off',
      maxTurns: 8,
      relevanceRanking: { topK: 2, minScore: 0 },
      skills: [
        { id: ' shared ', name: 'Constructor shared', content: 'old skill' },
        { name: ' empty-skill ', content: '' },
        { id: '', name: '', content: 'malformed' },
      ],
      skillsCatalog: [
        {
          id: 'catalog-release',
          name: 'Catalog release',
          description: 'release checklist',
          content: 'CATALOG SKILL MUST NOT WIN HOST PRECEDENCE',
        },
        {
          id: 'catalog-incident',
          name: 'Catalog incident',
          description: 'incident response',
          content: 'catalog incident body',
        },
      ],
      memoriesCatalog: [
        {
          id: 'catalog-deploy',
          content: 'CATALOG MEMORY MUST NOT WIN HOST PRECEDENCE',
        },
        { id: 'catalog-coffee', content: 'catalog coffee body' },
      ],
      onSkillsSearch: true,
      onMemoriesSearch: true,
      onLoadedSkills: true,
      onLoadedMemories: true,
      onUsedSkills: true,
      onUsedMemories: true,
      skillSearchResults: {
        release: [
          { id: 'host-release', name: 'Host release', content: 'HOST SKILL' },
        ],
      },
      memorySearchResults: {
        deploy: [
          { id: 'mem-a', content: 'HOST MEMORY OVERRIDE' },
          { id: 'host-memory', content: 'HOST MEMORY' },
        ],
      },
    },
    input: {
      query: 'prepare the release deploy',
      memories: [
        { id: ' mem-a ', content: 'PRELOADED MEMORY' },
        { id: 'z-memory', content: '' },
        { id: '', content: 'malformed' },
      ],
    },
    forward_options: {
      // Generated runtimes expose their actor-loop safety budget as a native
      // forward option. Keep it explicit here so the five-action oracle
      // scenario exercises lifecycle semantics instead of the native default.
      max_actor_steps: 8,
      skills: [
        { id: 'shared', name: 'Forward shared', content: 'FORWARD SKILL' },
        { id: 'forward-only', name: 'Forward only', content: '' },
      ],
      onUsedSkills: true,
      onUsedMemories: true,
    },
    responses: [
      {
        content:
          '{"javascriptCode":"final(\\"execute\\", {\\"context\\":\\"ready\\"})"}',
      },
      {
        content:
          '{"javascriptCode":"discover({\\"skills\\":[\\"release\\"]})"}',
      },
      { content: '{"javascriptCode":"recall([\\"deploy\\"])"}' },
      {
        content:
          '{"javascriptCode":"used(\\"shared\\", \\"forward override used\\")"}',
      },
      {
        content:
          '{"javascriptCode":"used(\\"mem-a\\", \\"preload then recall override used\\")"}',
      },
      {
        content:
          '{"javascriptCode":"final(\\"done\\", {\\"answer\\":\\"oracle\\"})"}',
      },
      { content: '{"answer":"oracle"}' },
    ],
    runtime_script: [
      {
        expected_code: 'final("execute", {"context":"ready"})',
        result: { type: 'final', args: ['execute', { context: 'ready' }] },
      },
      {
        expected_code: 'discover({"skills":["release"]})',
        result: { discover: { skills: ['release'] } },
      },
      {
        expected_code: 'recall(["deploy"])',
        result: { recall: ['deploy'] },
      },
      {
        expected_code: 'used("shared", "forward override used")',
        result: {
          used: { id: 'shared', reason: 'forward override used' },
        },
      },
      {
        expected_code: 'used("mem-a", "preload then recall override used")',
        result: {
          used: {
            id: 'mem-a',
            reason: 'preload then recall override used',
          },
        },
      },
      {
        expected_code: 'final("done", {"answer":"oracle"})',
        result: { type: 'final', args: ['done', { answer: 'oracle' }] },
      },
    ],
    expected_output: output as Json,
    expected_request_count: requestTranscript.length,
    expected_request_contains: [
      '### Likely Relevant',
      '### Available Skills',
      'ID: `shared`',
      'FORWARD SKILL',
      'HOST SKILL',
      'HOST MEMORY OVERRIDE',
      'ID: `mem-a`',
    ],
    expected_loaded_skill_docs_subset: loadedSkills as Json,
    expected_loaded_skill_docs: loadedSkills as Json,
    expected_loaded_memories: loadedMemories,
    expected_used_skills: usedSkills,
    expected_used_memories: usedMemories,
    expected_observer_transcript: observerTranscript as Json,
  });
}

async function writeSemanticParityStaticDirectSkillOracle(): Promise<void> {
  const requestTranscript: Array<{
    stage: string;
    system: string;
    user: string;
  }> = [];
  const ai = new AxMockAIService({
    features: { functions: false, streaming: false },
    chatResponse: async (request) => {
      const system = oraclePromptText(request.chatPrompt[0]?.content);
      const user = request.chatPrompt
        .filter((message) => message.role === 'user')
        .map((message) => oraclePromptText(message.content))
        .join('\n');
      const stage = system.includes('You (`distiller`)')
        ? 'distiller'
        : system.includes('You (`executor`)')
          ? 'executor'
          : 'responder';
      requestTranscript.push({ stage, system, user });
      const content =
        stage === 'distiller'
          ? 'Javascript Code: respond("direct", {"source":"forward-skill"})'
          : 'Answer: direct';
      return {
        results: [{ index: 0, content, finishReason: 'stop' as const }],
        modelUsage: oracleModelUsage(),
      };
    },
  });
  const oracle = agent('query:string -> answer:string', {
    ai,
    runtime: semanticDirectResponseRuntime(),
    skills: [
      {
        id: 'constructor-direct',
        name: 'Constructor direct',
        content: 'CONSTRUCTOR DIRECT SKILL',
      },
    ],
  });
  const output = await oracle.forward(
    ai,
    { query: 'answer directly' },
    {
      skills: [
        {
          id: 'forward-direct',
          name: 'Forward direct',
          content: 'FORWARD SKILL',
        },
      ],
    }
  );
  const stageRequests = semanticStageRequests(requestTranscript);
  writeFixture('semantic-parity-static-direct-skill-oracle', {
    parity_contract_ids: [
      'axagent.constructor.directResponse',
      'axagent.forward.skills',
      'axagent.method.forward',
    ],
    exact_observable_projection: {
      output,
      stageRequests,
      errors: [],
    } as Json,
    option_effect:
      'Removing forward skills hides FORWARD SKILL from the static direct-response distiller; disabling direct response introduces an executor request.',
    option_effects: {
      'axagent.constructor.directResponse': 'stageRequests',
      'axagent.forward.skills': 'stageRequests',
      'axagent.method.forward': 'output',
    },
    kind: 'agent_forward',
    signature: 'query:string -> answer:string',
    options: {
      runtime: { language: 'JavaScript' },
      skills: [
        {
          id: 'constructor-direct',
          name: 'Constructor direct',
          content: 'CONSTRUCTOR DIRECT SKILL',
        },
      ],
    },
    input: { query: 'answer directly' },
    forward_options: {
      skills: [
        {
          id: 'forward-direct',
          name: 'Forward direct',
          content: 'FORWARD SKILL',
        },
      ],
    },
    responses: [
      {
        content:
          '{"javascriptCode":"respond(\\"direct\\", {\\"source\\":\\"forward-skill\\"})"}',
      },
      { content: '{"answer":"direct"}' },
    ],
    runtime_script: [
      {
        expected_code: 'respond("direct", {"source":"forward-skill"})',
        result: {
          type: 'respond',
          args: ['direct', { source: 'forward-skill' }],
        },
      },
    ],
    expected_output: output as Json,
    expected_request_count: requestTranscript.length,
    expected_request_contains: ['FORWARD SKILL', 'ID: `forward-direct`'],
    expected_stage_request_not_contains: [
      { index: 0, absent: ['You (`executor`)'] },
    ],
  });
}

async function writeSemanticParityForwardResetOracle(): Promise<void> {
  const requestTranscript: Array<{
    stage: string;
    system: string;
    user: string;
  }> = [];
  const runLabels = ['one', 'two', 'three', 'four'] as const;
  let distillerTurn = 0;
  let executorTurn = 0;
  let responderTurn = 0;
  const ai = new AxMockAIService({
    features: { functions: false, streaming: false },
    chatResponse: async (request) => {
      const system = oraclePromptText(request.chatPrompt[0]?.content);
      const user = request.chatPrompt
        .filter((message) => message.role === 'user')
        .map((message) => oraclePromptText(message.content))
        .join('\n');
      const stage = system.includes('You (`distiller`)')
        ? 'distiller'
        : system.includes('You (`executor`)')
          ? 'executor'
          : 'responder';
      requestTranscript.push({ stage, system, user });
      let content: string;
      if (stage === 'distiller') {
        distillerTurn++;
        const label = runLabels[distillerTurn - 1] ?? `run-${distillerTurn}`;
        content = `Javascript Code: final("execute-${label}", {})`;
      } else if (stage === 'executor') {
        executorTurn++;
        const label = runLabels[executorTurn - 1] ?? `run-${executorTurn}`;
        content = `Javascript Code: final("answer-${label}", {"answer":"${label}"})`;
      } else {
        responderTurn++;
        const label = runLabels[responderTurn - 1] ?? `run-${responderTurn}`;
        content = `Answer: ${label}`;
      }
      return {
        results: [{ index: 0, content, finishReason: 'stop' as const }],
        modelUsage: oracleModelUsage(),
      };
    },
  });
  const oracle = agent('query:string -> answer:string', {
    ai,
    runtime: semanticSequenceRuntime(),
    directResponse: 'off',
    relevanceRanking: false,
    memoriesCatalog: [
      { id: 'catalog-unused', content: 'UNUSED CATALOG MEMORY' },
    ],
    skills: [
      {
        id: 'constructor-preset',
        name: 'Constructor preset',
        content: 'CONSTRUCTOR PRESET SKILL',
      },
    ],
  });
  const outputs: Json[] = [];
  const runStateProjections: Json[] = [];
  const stateRoundtrip: Record<string, Json> = {};
  let savedState: ReturnType<typeof oracle.getState>;
  const projectState = (state: ReturnType<typeof oracle.getState>): Json => ({
    loaded_skill_docs: state?.skillsPromptState?.loaded ?? [],
  });
  const runInputs: Array<{
    values: Record<string, unknown>;
    options: Record<string, unknown>;
    stateAction?: 'reset' | 'restore_saved';
    saveRuntimeState?: boolean;
  }> = [
    {
      values: {
        query: 'first run',
        memories: [{ id: 'run-memory', content: 'HOST MEMORY FIRST RUN' }],
      },
      options: {
        skills: [
          {
            id: 'forward-persist',
            name: 'Forward persist',
            content: 'FORWARD SKILL',
          },
        ],
      },
      saveRuntimeState: true,
    },
    { values: { query: 'second run' }, options: {} },
    {
      values: { query: 'third run after reset' },
      options: {},
      stateAction: 'reset',
    },
    {
      values: { query: 'fourth run after restore' },
      options: {},
      stateAction: 'restore_saved',
    },
  ];
  for (const run of runInputs) {
    if (run.stateAction === 'reset') {
      oracle.setState(undefined);
    } else if (run.stateAction === 'restore_saved') {
      oracle.setState(savedState);
      stateRoundtrip.restored = projectState(oracle.getState());
    }
    const requestStart = requestTranscript.length;
    outputs.push(
      (await oracle.forward(ai, run.values as never, run.options)) as Json
    );
    const state = oracle.getState();
    const executorUser =
      requestTranscript
        .slice(requestStart)
        .findLast((entry) => entry.stage === 'executor')?.user ?? '';
    const loadedMemories = [
      ...executorUser.matchAll(
        /### Memory\n\nID: `([^`]+)`\n\n([\s\S]*?)(?=\n\n### Memory|\n\n[A-Z][A-Za-z ]+:|$)/g
      ),
    ].map((match) => ({ id: match[1]!, content: match[2]!.trim() }));
    runStateProjections.push({
      loaded_skill_docs: state?.skillsPromptState?.loaded ?? [],
      loaded_memories: loadedMemories,
      used_skills: [],
      used_memories: [],
    });
    if (run.saveRuntimeState) {
      savedState = oracle.getState();
      stateRoundtrip.saved = projectState(savedState);
    }
  }
  const stageRequests = semanticStageRequests(requestTranscript);
  writeFixture('semantic-parity-forward-reset-oracle', {
    parity_contract_ids: [
      'axagent.constructor.skills',
      'axagent.forward.skills',
      'axagent.method.forward',
      'axagent.method.getState',
      'axagent.method.setState',
      'axagent.state.skillsPromptState',
    ],
    exact_observable_projection: {
      output: outputs,
      stageRequests,
      runStateProjections,
      stateRoundtrip,
      errors: [],
    } as Json,
    option_effect:
      'Removing constructor or forward skills changes run projections; retaining values.memories across forwards changes the second run; ignoring reset or restore changes the third, fourth, and state-roundtrip projections.',
    option_effects: {
      'axagent.constructor.skills': 'runStateProjections',
      'axagent.forward.skills': 'runStateProjections',
      'axagent.method.forward': 'output',
      'axagent.method.getState': 'stateRoundtrip.saved',
      'axagent.method.setState': 'stateRoundtrip.restored',
      'axagent.state.skillsPromptState': 'runStateProjections',
    },
    kind: 'agent_forward',
    signature: 'query:string -> answer:string',
    options: {
      runtime: { language: 'JavaScript' },
      directResponse: 'off',
      relevanceRanking: false,
      memoriesCatalog: [
        { id: 'catalog-unused', content: 'UNUSED CATALOG MEMORY' },
      ],
      skills: [
        {
          id: 'constructor-preset',
          name: 'Constructor preset',
          content: 'CONSTRUCTOR PRESET SKILL',
        },
      ],
    },
    forward_runs: [
      {
        input: {
          query: 'first run',
          memories: [{ id: 'run-memory', content: 'HOST MEMORY FIRST RUN' }],
        },
        forward_options: {
          skills: [
            {
              id: 'forward-persist',
              name: 'Forward persist',
              content: 'FORWARD SKILL',
            },
          ],
        },
        save_runtime_state: true,
      },
      { input: { query: 'second run' }, forward_options: {} },
      {
        input: { query: 'third run after reset' },
        forward_options: {},
        state_action: 'reset',
      },
      {
        input: { query: 'fourth run after restore' },
        forward_options: {},
        state_action: 'restore_saved',
      },
    ],
    responses: runLabels.flatMap((label) => [
      { content: `{"javascriptCode":"final(\\"execute-${label}\\", {})"}` },
      {
        content: `{"javascriptCode":"final(\\"answer-${label}\\", {\\"answer\\":\\"${label}\\"})"}`,
      },
      { content: `{"answer":"${label}"}` },
    ]),
    runtime_script: runLabels.flatMap((label) => [
      {
        expected_code: `final("execute-${label}", {})`,
        result: { type: 'final', args: [`execute-${label}`, {}] },
      },
      {
        expected_code: `final("answer-${label}", {"answer":"${label}"})`,
        result: {
          type: 'final',
          args: [`answer-${label}`, { answer: label }],
        },
      },
    ]),
    expected_output: outputs,
    expected_request_count: requestTranscript.length,
    expected_request_contains: [
      'CONSTRUCTOR PRESET SKILL',
      'FORWARD SKILL',
      'HOST MEMORY FIRST RUN',
    ],
    expected_stage_request_not_contains: [
      { index: 4, absent: ['HOST MEMORY FIRST RUN'] },
      { index: 7, absent: ['HOST MEMORY FIRST RUN', 'FORWARD SKILL'] },
    ],
    expected_run_state_projections: runStateProjections,
    expected_state_roundtrip_projection: stateRoundtrip,
  });
}

function rankingProbeProjection(
  requestTranscript: Array<{ stage: string; system: string; user: string }>,
  probes: ReadonlyArray<{ label: string; needle: string }>
): Json {
  const firstExecutor = requestTranscript.find(
    (request) => request.stage === 'executor'
  );
  const system = firstExecutor?.system ?? '';
  const user = firstExecutor?.user ?? '';
  return {
    hasLikelyRelevant: system.includes('Likely Relevant'),
    matches: Object.fromEntries(
      probes.map(({ label, needle }) => [label, user.includes(needle)])
    ),
  } as Json;
}

async function writeSemanticParityCatalogRankingOracles(): Promise<void> {
  const longSkillContent = `${'x'.repeat(600)}needleafterlimit`;
  const deployMemoryContent = `Deploy primary release runbook ${'x'.repeat(90)} AFTER_SNIPPET`;
  const longMemoryContent = `${'x'.repeat(600)}needleafterlimit`;
  const probes = [
    { label: 'identifier_skill', needle: '`lookupInvoiceStatus` —' },
    { label: 'ranked_memory', needle: '`deploy-primary` —' },
    { label: 'loaded_memory_excluded', needle: '`loaded-deploy` —' },
    {
      label: 'memory_snippet_80',
      needle: deployMemoryContent.replace(/\s+/g, ' ').trim().slice(0, 80),
    },
    { label: 'memory_after_snippet', needle: 'AFTER_SNIPPET' },
    { label: 'skill_after_600', needle: 'skill-beyond-limit' },
    { label: 'memory_after_600', needle: 'memory-beyond-limit' },
  ] as const;
  const requestTranscript: Array<{
    stage: string;
    system: string;
    user: string;
  }> = [];
  const distillerCodes = ['final("catalog execute", {})'];
  const executorCodes = [
    'discover({"skills":["invoice status"]}) // discover-invoice',
    'recall(["deploy release"]) // recall-deploy',
    'discover({"skills":["needleafterlimit"]}) // discover-limit',
    'recall(["needleafterlimit"]) // recall-limit',
    'final("catalog done", {"answer":"catalog"})',
  ];
  let distillerIndex = 0;
  let executorIndex = 0;
  const ai = new AxMockAIService({
    features: { functions: false, streaming: false },
    chatResponse: async (request) => {
      const system = oraclePromptText(request.chatPrompt[0]?.content);
      const user = request.chatPrompt
        .filter((message) => message.role === 'user')
        .map((message) => oraclePromptText(message.content))
        .join('\n');
      const stage = system.includes('You (`distiller`)')
        ? 'distiller'
        : system.includes('You (`executor`)')
          ? 'executor'
          : 'responder';
      requestTranscript.push({ stage, system, user });
      const content =
        stage === 'distiller'
          ? `Javascript Code: ${distillerCodes[distillerIndex++]}`
          : stage === 'executor'
            ? `Javascript Code: ${executorCodes[executorIndex++]}`
            : 'Answer: catalog';
      return {
        results: [{ index: 0, content, finishReason: 'stop' as const }],
        modelUsage: oracleModelUsage(),
      };
    },
  });
  const catalogOptions = {
    ai,
    runtime: semanticCatalogRuntime(),
    directResponse: 'off' as const,
    relevanceRanking: { topK: 1, minScore: 0 },
    skillsCatalog: [
      {
        id: 'lookupInvoiceStatus',
        name: 'Invoice status lookup',
        description: 'invoice status billing lookup',
        content: 'IDENTIFIER SKILL BODY',
      },
      {
        id: 'skill-beyond-limit',
        name: 'Archive helper',
        description: 'archive helper',
        content: longSkillContent,
      },
      {
        id: 'unrelated-skill',
        name: 'Weather helper',
        description: 'weather forecast',
        content: 'forecast rain',
      },
    ],
    memoriesCatalog: [
      {
        id: 'loaded-deploy',
        content: 'deploy release strongest loaded memory',
      },
      { id: 'deploy-primary', content: deployMemoryContent },
      { id: 'deploy-secondary', content: 'deploy secondary note' },
      { id: 'memory-beyond-limit', content: longMemoryContent },
    ],
  };
  const oracle = agent('query:string -> answer:string', catalogOptions);
  const output = await oracle.forward(ai, {
    query: 'invoice status deploy release needleafterlimit',
    memories: [
      {
        id: 'loaded-deploy',
        content: 'deploy release strongest loaded memory',
      },
    ],
  } as never);
  const state = oracle.getState();
  const finalExecutorUser =
    [...requestTranscript].reverse().find((entry) => entry.stage === 'executor')
      ?.user ?? '';
  const loadedMemories = [
    ...finalExecutorUser.matchAll(
      /### Memory\n\nID: `([^`]+)`\n\n([\s\S]*?)(?=\n\n### Memory|\n\n[A-Z][A-Za-z ]+:|$)/g
    ),
  ].map((match) => ({ id: match[1]!, content: match[2]!.trim() }));
  const stageRequests = semanticStageRequests(requestTranscript);
  const ranking = rankingProbeProjection(requestTranscript, probes);
  const loadedSkills = state?.skillsPromptState?.loaded ?? [];
  writeFixture('semantic-parity-catalog-ranking-oracle', {
    parity_contract_ids: [
      'axagent.constructor.skillsCatalog',
      'axagent.constructor.memoriesCatalog',
      'axagent.constructor.relevanceRanking',
      'axagent.method.forward',
    ],
    exact_observable_projection: {
      output,
      stageRequests,
      ranking,
      loadedSkills,
      loadedMemories,
      errors: [],
    } as Json,
    option_effect:
      'Removing either static catalog changes exact loaded state; ignoring ranking changes the topK hint, snippet, loaded exclusion, identifier, and 600-character probes.',
    option_effects: {
      'axagent.constructor.skillsCatalog': 'loadedSkills',
      'axagent.constructor.memoriesCatalog': 'loadedMemories',
      'axagent.constructor.relevanceRanking': 'ranking',
      'axagent.method.forward': 'output',
    },
    kind: 'agent_forward',
    signature: 'query:string -> answer:string',
    options: {
      runtime: { language: 'JavaScript' },
      directResponse: 'off',
      relevanceRanking: { topK: 1, minScore: 0 },
      skillsCatalog: catalogOptions.skillsCatalog,
      memoriesCatalog: catalogOptions.memoriesCatalog,
    },
    input: {
      query: 'invoice status deploy release needleafterlimit',
      memories: [
        {
          id: 'loaded-deploy',
          content: 'deploy release strongest loaded memory',
        },
      ],
    },
    forward_options: { max_actor_steps: 8 },
    responses: [...distillerCodes, ...executorCodes, 'catalog'].map(
      (content, index, values) => ({
        content:
          index === values.length - 1
            ? '{"answer":"catalog"}'
            : `{"javascriptCode":${JSON.stringify(content)}}`,
      })
    ),
    runtime_script: [
      {
        expected_code: distillerCodes[0],
        result: { type: 'final', args: ['catalog execute', {}] },
      },
      {
        expected_code: executorCodes[0],
        result: { discover: { skills: ['invoice status'] } },
      },
      {
        expected_code: executorCodes[1],
        result: { recall: ['deploy release'] },
      },
      {
        expected_code: executorCodes[2],
        result: { discover: { skills: ['needleafterlimit'] } },
      },
      {
        expected_code: executorCodes[3],
        result: { recall: ['needleafterlimit'] },
      },
      {
        expected_code: executorCodes[4],
        result: {
          type: 'final',
          args: ['catalog done', { answer: 'catalog' }],
        },
      },
    ],
    ranking_probe: probes,
    expected_output: output as Json,
    expected_loaded_skill_docs: loadedSkills as Json,
    expected_loaded_memories: loadedMemories as Json,
    expected_request_count: requestTranscript.length,
  });

  const tieRequests: Array<{ stage: string; system: string; user: string }> =
    [];
  let tieDistiller = 0;
  let tieExecutor = 0;
  const tieAI = new AxMockAIService({
    features: { functions: false, streaming: false },
    chatResponse: async (request) => {
      const system = oraclePromptText(request.chatPrompt[0]?.content);
      const user = request.chatPrompt
        .filter((message) => message.role === 'user')
        .map((message) => oraclePromptText(message.content))
        .join('\n');
      const stage = system.includes('You (`distiller`)')
        ? 'distiller'
        : system.includes('You (`executor`)')
          ? 'executor'
          : 'responder';
      tieRequests.push({ stage, system, user });
      const content =
        stage === 'distiller'
          ? `Javascript Code: ${['final("execute-one", {})'][tieDistiller++]}`
          : stage === 'executor'
            ? `Javascript Code: ${['final("answer-one", {"answer":"tie"})'][tieExecutor++]}`
            : 'Answer: tie';
      return {
        results: [{ index: 0, content, finishReason: 'stop' as const }],
        modelUsage: oracleModelUsage(),
      };
    },
  });
  const tieOracle = agent('query:string -> answer:string', {
    ai: tieAI,
    runtime: semanticSequenceRuntime(),
    directResponse: 'off',
    relevanceRanking: true,
    skillsCatalog: [
      { id: 'tie-skill-a', name: 'Tie A', content: 'zebra quokka' },
      { id: 'tie-skill-b', name: 'Tie B', content: 'zebra quokka' },
    ],
    memoriesCatalog: [
      { id: 'tie-memory-a', content: 'zebra quokka' },
      { id: 'tie-memory-b', content: 'zebra quokka' },
    ],
  });
  const tieOutput = await tieOracle.forward(tieAI, {
    query: 'zebra quokka',
  } as never);
  const tieProbes = [
    { label: 'tie_skill_a', needle: '`tie-skill-a` —' },
    { label: 'tie_memory_a', needle: '`tie-memory-a` —' },
  ];
  const tieRanking = rankingProbeProjection(tieRequests, tieProbes);
  writeFixture('semantic-parity-ranking-tie-oracle', {
    parity_contract_ids: ['axagent.constructor.relevanceRanking'],
    exact_observable_projection: {
      output: tieOutput,
      ranking: tieRanking,
      errors: [],
    } as Json,
    option_effect:
      'Changing default tie suppression makes the tied skill or memory catalog appear in the exact relevance-hint projection.',
    option_effects: {
      'axagent.constructor.relevanceRanking': 'ranking',
    },
    kind: 'agent_forward',
    signature: 'query:string -> answer:string',
    options: {
      runtime: { language: 'JavaScript' },
      directResponse: 'off',
      relevanceRanking: true,
      skillsCatalog: [
        { id: 'tie-skill-a', name: 'Tie A', content: 'zebra quokka' },
        { id: 'tie-skill-b', name: 'Tie B', content: 'zebra quokka' },
      ],
      memoriesCatalog: [
        { id: 'tie-memory-a', content: 'zebra quokka' },
        { id: 'tie-memory-b', content: 'zebra quokka' },
      ],
    },
    input: { query: 'zebra quokka' },
    responses: [
      { content: '{"javascriptCode":"final(\\"execute-one\\", {})"}' },
      {
        content:
          '{"javascriptCode":"final(\\"answer-one\\", {\\"answer\\":\\"tie\\"})"}',
      },
      { content: '{"answer":"tie"}' },
    ],
    runtime_script: [
      {
        expected_code: 'final("execute-one", {})',
        result: { type: 'final', args: ['execute-one', {}] },
      },
      {
        expected_code: 'final("answer-one", {"answer":"tie"})',
        result: { type: 'final', args: ['answer-one', { answer: 'tie' }] },
      },
    ],
    ranking_probe: tieProbes,
    expected_output: tieOutput as Json,
    expected_request_count: tieRequests.length,
  });
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
        'distilledContextSummary',
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
        'relevanceHints',
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
  expected_error_contains: errorMessage(() =>
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

writeFixture('context-policy-prune-errors-migration-error', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    contextPolicy: { pruneErrors: true },
  },
  context_operation: 'resolve_policy',
  expected_error_contains: errorMessage(() =>
    resolveContextPolicy({ pruneErrors: true } as never)
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
      liveRuntimeState:
        'Current runtime state:\n- alpha: 1\n- beta: {"ok":true}',
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

const tombstoneOriginalActionLog: ActionLogEntry[] = [
  {
    turn: 1,
    code: 'triggerError()',
    output: 'Error: Execution timed out',
    tags: ['error'],
    stepKind: 'error',
    stateDelta: 'Runtime error; no durable runtime state update',
  },
  {
    turn: 2,
    code: 'var y = 99; y',
    output: '99',
    tags: [],
    producedVars: ['y'],
    referencedVars: [],
    stepKind: 'transform',
    stateDelta: 'Updated live runtime values: y',
  },
];
const tombstoneManagedActionLog = JSON.parse(
  JSON.stringify(tombstoneOriginalActionLog)
) as ActionLogEntry[];
const tombstoneEvents: Json[] = [];
await manageContext(
  tombstoneManagedActionLog,
  1,
  resolveContextPolicy({ preset: 'adaptive' }),
  undefined,
  undefined,
  {
    stage: 'executor',
    onContextEvent: (event) => {
      tombstoneEvents.push(event as unknown as Json);
    },
  }
);
const tombstoneParts = buildActionLogParts(tombstoneManagedActionLog, {
  actionReplay: 'adaptive',
  recentFullActions: 2,
  hygieneMode: 'proactive',
});
writeFixture('context-tombstone-resolved-error-adaptive', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    runtime: { language: 'JavaScript' },
    contextPolicy: { preset: 'adaptive' },
  },
  context_operation: 'manage_context',
  action_log: tombstoneOriginalActionLog as unknown as Json[],
  expected_context_result_subset: {
    prepared: {
      actionLog: tombstoneParts.history,
    },
  },
  expected_context_events_subset: tombstoneEvents,
});

const verboseTestOutput = [
  'FAILED tests/auth.test.ts::rejects_bad_token - AssertionError: expected 401 got 200',
  ...Array.from(
    { length: 40 },
    (_, index) => `verbose passing test log line ${index}`
  ),
  '================ 94 passed, 1 failed in 3.5s ================',
].join('\n');
const distillActionLog: ActionLogEntry[] = [
  {
    turn: 1,
    code: 'const testOutput = await runTests(); console.log(testOutput)',
    output: verboseTestOutput,
    tags: [],
    producedVars: ['testOutput'],
    referencedVars: [],
    stepKind: 'query',
    stateDelta: 'Updated live runtime values: testOutput',
  },
  {
    turn: 2,
    code: 'console.log("middle")',
    output: 'middle',
    tags: [],
    producedVars: [],
    referencedVars: [],
    stepKind: 'explore',
    stateDelta:
      'Inspected runtime state without creating durable runtime values',
  },
];
const distillParts = buildActionLogParts(distillActionLog, {
  actionReplay: 'minimal',
  recentFullActions: 1,
  hygieneMode: 'aggressive',
});
writeFixture('context-action-log-distilled-test-output', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    runtime: { language: 'JavaScript' },
    contextPolicy: { preset: 'lean', budget: 'balanced' },
  },
  context_operation: 'prepare',
  action_log: distillActionLog as unknown as Json[],
  expected_context_result_subset: {
    prepared: {
      actionLog: distillParts.history,
    },
  },
  expected_context_events_subset: [
    {
      kind: 'action_compacted',
      stage: 'executor',
      turn: 1,
      mode: 'distill',
      reason: 'structured_output',
    },
  ],
});

const checkpointWorkingEntries: ActionLogEntry[] = [
  {
    turn: 1,
    code: 'const draft = "v1"',
    output: 'draft ready',
    tags: [],
    producedVars: ['draft'],
    referencedVars: [],
    _durableReads: [],
    stepKind: 'transform',
    stateDelta: 'Updated live runtime values: draft',
  },
  {
    turn: 2,
    code: 'const finalDraft = draft + " polished"',
    output: 'final ready',
    tags: [],
    producedVars: ['finalDraft'],
    referencedVars: ['draft'],
    _durableReads: ['draft'],
    stepKind: 'transform',
    stateDelta: 'Updated live runtime values: finalDraft; read: draft',
  },
];
writeFixture('context-checkpoint-working-state-summary', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  context_operation: 'checkpoint_summary',
  checkpoint_entries: checkpointWorkingEntries as unknown as Json[],
  checkpoint_turns: [1, 2],
  expected_context_result: {
    summary: extractWorkingCodeState(checkpointWorkingEntries),
  },
});

const provenanceActionLog: ActionLogEntry[] = [
  {
    turn: 1,
    code: 'const rows = await db.search({ query: "widgets" })',
    output: '[{"id":1}]',
    tags: [],
    producedVars: ['rows'],
    referencedVars: ['db', 'search'],
    _functionCalls: [
      {
        qualifiedName: 'db.search',
        name: 'search',
        arguments: { query: 'widgets' },
        result: [{ id: 1 }],
      },
    ],
    stepKind: 'transform',
    stateDelta: 'Updated live runtime values: rows; callables: db.search',
  },
  {
    turn: 2,
    code: 'console.log(rows.length)',
    output: '1',
    tags: [],
    producedVars: [],
    referencedVars: ['rows'],
    stepKind: 'explore',
    stateDelta: 'read: rows',
  },
];
const runtimeEntries = [
  {
    name: 'rows',
    type: 'array',
    size: '1 items',
    preview: '[{"id":1}]',
  },
  {
    name: 'staleNote',
    type: 'string',
    size: '6 chars',
    preview: '"unused"',
  },
];
const provenance = Object.fromEntries(
  buildRuntimeStateProvenance(provenanceActionLog).entries()
) as Json;
const provenanceRuntimeState = `Current runtime state:\n${formatStructuredRuntimeState(
  runtimeEntries,
  buildRuntimeStateProvenance(provenanceActionLog),
  { maxEntries: 8, maxChars: 1200 }
)}`;
writeFixture('context-runtime-state-provenance-summary', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    runtime: { language: 'JavaScript' },
    contextPolicy: { preset: 'adaptive', budget: 'compact' },
  },
  context_operation: 'prepare',
  action_log: provenanceActionLog as unknown as Json[],
  provenance,
  runtime_session_state: {
    entries: runtimeEntries,
  },
  expected_context_result_subset: {
    prepared: {
      liveRuntimeState: provenanceRuntimeState,
    },
    exported: {
      provenance,
    },
  },
});

writeFixture('context-full-preset-omits-pressure-field', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    runtime: { language: 'JavaScript' },
    contextPolicy: { preset: 'full' },
  },
  context_operation: 'prepare',
  action_log: compactingActionLog as unknown as Json[],
  expected_context_result_subset: {
    prepared: {
      contextPressure: '',
    },
  },
});

writeFixture('context-export-restore-preserves-provenance-state', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    runtime: { language: 'JavaScript' },
    contextPolicy: { preset: 'adaptive' },
  },
  restore_runtime_state: {
    action_log: provenanceActionLog as unknown as Json[],
    checkpoint_state: {
      fingerprint: 'checkpoint-1',
      turns: [1],
      summary: checkpointSummary,
    },
    context_events: [
      {
        kind: 'checkpoint_created',
        stage: 'executor',
        turn: 2,
        coveredTurns: [1],
        reason: 'over_budget',
      },
    ],
    guidance_log: [{ turn: 1, guidance: 'Keep it concise.' }],
    provenance,
    runtime_session_state: {
      entries: runtimeEntries,
    },
    actor_model_state: {
      consecutiveErrorTurns: 1,
      matchedNamespaces: ['db'],
    },
  },
  context_operation: 'prepare',
  expected_context_result_subset: {
    exported: {
      checkpoint_state: {
        fingerprint: 'checkpoint-1',
        turns: [1],
        summary: checkpointSummary,
      },
      guidance_log: [{ turn: 1, guidance: 'Keep it concise.' }],
      provenance,
      actor_model_state: {
        consecutiveErrorTurns: 1,
        matchedNamespaces: ['db'],
      },
      action_log: [
        {
          turn: 1,
          code: 'const rows = await db.search({ query: "widgets" })',
          output: '[{"id":1}]',
          tags: [],
          producedVars: ['rows'],
          referencedVars: ['db', 'search'],
          stateDelta: 'Updated live runtime values: rows; callables: db.search',
          stepKind: 'transform',
        },
        {
          turn: 2,
          code: 'console.log(rows.length)',
          output: '1',
          tags: [],
          producedVars: [],
          referencedVars: ['rows'],
          stateDelta: 'read: rows',
          stepKind: 'explore',
        },
      ],
    },
  },
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
    skillsCatalog: [
      { id: 'sql', name: 'sql', content: 'Use parameterized SQL queries.' },
    ],
  },
  discover: { skills: ['sql'] },
  expected_discover_result: null,
  expected_loaded_skill_docs_subset: [
    { id: 'sql', name: 'sql', content: 'Use parameterized SQL queries.' },
  ],
  expected_policy_trace_subset: [
    { type: 'discover', tools: [], skills: ['sql'] },
  ],
});

writeFixture('constructor-preloaded-skills', {
  kind: 'agent_runtime_policy',
  signature: 'question:string -> answer:string',
  options: {
    skills: [
      {
        id: 'skill.release-checklist',
        name: 'Release checklist',
        content: 'Verify tests, package contents, and release notes.',
      },
      {
        name: 'incident-response',
        content: 'Stabilize the incident before investigating root cause.',
      },
    ],
  },
  expected_loaded_skill_docs_subset: [
    {
      id: 'incident-response',
      name: 'incident-response',
      content: 'Stabilize the incident before investigating root cause.',
    },
    {
      id: 'skill.release-checklist',
      name: 'Release checklist',
      content: 'Verify tests, package contents, and release notes.',
    },
  ],
});

writeFixture('agent-prompt-preloaded-skills', {
  kind: 'agent_prompt',
  signature: 'question:string -> answer:string',
  options: {
    runtime: { language: 'JavaScript' },
    skills: [
      {
        id: 'skill.release-checklist',
        name: 'Release checklist',
        content: 'Verify tests, package contents, and release notes.',
      },
    ],
  },
  expected_description_contains: {
    executor_description: ['### Loaded Skills'],
  },
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
    { id: 'skill.sql', name: 'sql', content: 'Duplicate should dedupe.' },
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
    loaded_skill_docs: [{ name: 'sql', content: 'Use parameterized SQL.' }],
    policy_trace: [{ type: 'discover', tools: ['docs'], skills: ['sql'] }],
  },
  expected_exported_state_subset: {
    runtime_state: { session: 'restored' },
    discovered_tool_docs: [
      { namespace: 'docs', name: 'search', qualified_name: 'docs.search' },
    ],
    loaded_skill_docs: [
      { id: 'sql', name: 'sql', content: 'Use parameterized SQL.' },
    ],
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
    skillsCatalog: [
      { id: 'sql', name: 'sql', content: 'Use parameterized SQL.' },
    ],
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
      { id: 'sql', name: 'sql', content: 'Use parameterized SQL.' },
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
          'respond',
          'askClarification',
          'discover',
          'recall',
          'llmQuery',
          'inspectRuntime',
          'reportSuccess',
          'reportFailure',
          'question',
          'user',
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
      'respond',
      'askClarification',
      'discover',
      'recall',
      'llmQuery',
      'inspectRuntime',
      'reportSuccess',
      'reportFailure',
      'question',
      'user',
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
      'respond',
      'askClarification',
      'discover',
      'recall',
      'llmQuery',
      'inspectRuntime',
      'reportSuccess',
      'reportFailure',
      'question',
      'user',
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

await writeSemanticParityLifecycleOracle();
await writeSemanticParityStaticDirectSkillOracle();
await writeSemanticParityForwardResetOracle();
await writeSemanticParityCatalogRankingOracles();
