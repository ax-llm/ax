import { describe, expect, it } from 'vitest';
import { AxMockAIService } from '../ai/mock/api.js';
import { AxJSRuntime } from '../funcs/jsRuntime.js';
import {
  DEFAULT_AUTO_CONTEXT_PREVIEW_CHARS,
  DEFAULT_AUTO_CONTEXT_PROMOTE_CHARS,
  DEFAULT_AUTO_DISCOVERY_FUNCTION_DOC_CHARS,
  resolveAutoUpgrade,
} from './config.js';
import type { AxAgentContextEvent } from './contextEvents.js';
import { agent } from './index.js';
import { estimateInlineFunctionDocChars } from './runtimeDiscovery.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeModelUsage = () => ({
  ai: 'mock',
  model: 'mock',
  tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
});

type StageScripts = {
  distiller: string[];
  executor: string[];
  responder?: string;
};

type PromptCapture = {
  distillerPrompts: string[];
  executorPrompts: string[];
  responderPrompts: string[];
};

const makeCapture = (): PromptCapture => ({
  distillerPrompts: [],
  executorPrompts: [],
  responderPrompts: [],
});

/**
 * Scripted mock model: dispatches on the stage system prompt and pops the
 * stage's next code turn. Captures each stage's user prompts for assertions.
 */
function scriptedAI(scripts: StageScripts, capture?: PromptCapture) {
  let distillerTurn = 0;
  let executorTurn = 0;
  return new AxMockAIService({
    features: { functions: false, streaming: false },
    chatResponse: async (req) => {
      const systemPrompt = String(req.chatPrompt[0]?.content ?? '');
      const userText = req.chatPrompt
        .filter((m) => m.role === 'user')
        .map((m) => String(m.content ?? ''))
        .join('\n');
      const respond = (content: string) => ({
        results: [{ index: 0, content, finishReason: 'stop' as const }],
        modelUsage: makeModelUsage(),
      });
      if (systemPrompt.includes('You (`distiller`)')) {
        capture?.distillerPrompts.push(userText);
        const code =
          scripts.distiller[
            Math.min(distillerTurn, scripts.distiller.length - 1)
          ];
        distillerTurn++;
        return respond(`Javascript Code: ${code}`);
      }
      if (systemPrompt.includes('You (`executor`)')) {
        capture?.executorPrompts.push(userText);
        const code =
          scripts.executor[Math.min(executorTurn, scripts.executor.length - 1)];
        executorTurn++;
        return respond(`Javascript Code: ${code}`);
      }
      if (systemPrompt.includes('Answer Synthesis Agent')) {
        capture?.responderPrompts.push(userText);
        return respond(scripts.responder ?? 'Answer: ok');
      }
      return respond('Answer: fallback');
    },
  });
}

/** A tool with docs large enough to matter for the discovery estimator. */
function makeBigFunction(index: number) {
  return {
    name: `bigTool${index}`,
    description: `Tool ${index}. ${'detail '.repeat(60)}`,
    parameters: {
      type: 'object' as const,
      properties: {
        query: { type: 'string' as const, description: 'q '.repeat(30) },
      },
      required: ['query'],
    },
    func: async () => 'ok',
  };
}

/** Discoverable-doc estimate above the default auto-discovery threshold. */
function makeBigCatalog() {
  return Array.from({ length: 30 }, (_, i) => makeBigFunction(i));
}

const smallFunctions = [
  {
    name: 'ping',
    description: 'Ping.',
    parameters: { type: 'object' as const, properties: {} },
    func: async () => 'pong',
  },
];

// A 9,010-char doc whose needle sits past the 1,200-char preview window.
const NEEDLE = 'DEEP-TOKEN';
const BIG_DOC = 'a'.repeat(2000) + NEEDLE + 'b'.repeat(7000);

const promotionEvents = (events: readonly AxAgentContextEvent[]) =>
  events.filter(
    (e): e is Extract<AxAgentContextEvent, { kind: 'field_auto_promoted' }> =>
      e.kind === 'field_auto_promoted'
  );

// ---------------------------------------------------------------------------
// resolveAutoUpgrade
// ---------------------------------------------------------------------------

describe('resolveAutoUpgrade', () => {
  it('defaults to both upgrades enabled with default thresholds', () => {
    const resolved = resolveAutoUpgrade(undefined);
    expect(resolved.functionDiscovery.enabled).toBe(true);
    expect(resolved.functionDiscovery.aboveFunctionDocChars).toBe(
      DEFAULT_AUTO_DISCOVERY_FUNCTION_DOC_CHARS
    );
    expect(resolved.contextFields.enabled).toBe(true);
    expect(resolved.contextFields.promoteAboveChars).toBe(
      DEFAULT_AUTO_CONTEXT_PROMOTE_CHARS
    );
    expect(resolved.contextFields.previewChars).toBe(
      DEFAULT_AUTO_CONTEXT_PREVIEW_CHARS
    );
  });

  it('normalizes boolean and partial-object forms', () => {
    expect(resolveAutoUpgrade(false).functionDiscovery.enabled).toBe(false);
    expect(resolveAutoUpgrade(false).contextFields.enabled).toBe(false);
    expect(resolveAutoUpgrade(true).contextFields.enabled).toBe(true);

    const contextOff = resolveAutoUpgrade({ contextFields: false });
    expect(contextOff.functionDiscovery.enabled).toBe(true);
    expect(contextOff.contextFields.enabled).toBe(false);

    const tuned = resolveAutoUpgrade({
      functionDiscovery: { aboveFunctionDocChars: 5 },
      contextFields: { promoteAboveChars: 100, previewChars: 10 },
    });
    expect(tuned.functionDiscovery.enabled).toBe(true);
    expect(tuned.functionDiscovery.aboveFunctionDocChars).toBe(5);
    expect(tuned.contextFields.promoteAboveChars).toBe(100);
    expect(tuned.contextFields.previewChars).toBe(10);
  });

  it('rejects invalid thresholds', () => {
    expect(() =>
      resolveAutoUpgrade({ contextFields: { promoteAboveChars: -1 } })
    ).toThrow('autoUpgrade.contextFields.promoteAboveChars');
    expect(() =>
      resolveAutoUpgrade({
        functionDiscovery: { aboveFunctionDocChars: Number.NaN },
      })
    ).toThrow('autoUpgrade.functionDiscovery.aboveFunctionDocChars');
  });
});

// ---------------------------------------------------------------------------
// estimateInlineFunctionDocChars
// ---------------------------------------------------------------------------

describe('estimateInlineFunctionDocChars', () => {
  it('counts discoverable functions and skips alwaysInclude ones', () => {
    const fn = makeBigFunction(0);
    const base = estimateInlineFunctionDocChars([fn as any]);
    expect(base).toBeGreaterThan(fn.description.length);
    expect(
      estimateInlineFunctionDocChars([
        { ...fn, _alwaysInclude: true } as any,
        fn as any,
      ])
    ).toBe(base);
    expect(estimateInlineFunctionDocChars([])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Auto function discovery
// ---------------------------------------------------------------------------

describe('autoUpgrade: function discovery', () => {
  const runtime = new AxJSRuntime();

  it('auto-enables discovery for a large catalog on both stages', () => {
    const testAgent = agent('query:string -> answer:string', {
      runtime,
      functions: makeBigCatalog(),
    });
    expect((testAgent.executor as any).functionDiscoveryEnabled).toBe(true);
    expect((testAgent.distiller as any).functionDiscoveryEnabled).toBe(true);

    const actorInputs = (testAgent.executor as any).actorProgram
      .getSignature()
      .getInputFields();
    expect(
      actorInputs.find((f: { name: string }) => f.name === 'discoveredToolDocs')
    ).toBeDefined();
  });

  it('recomputes the module relevance hint after auto-enabling discovery', () => {
    const testAgent = agent('query:string -> answer:string', {
      runtime,
      functions: makeBigCatalog(),
    });
    // relevanceRanking defaults ON; auto-enabled discovery must light it up.
    expect((testAgent.executor as any).moduleHintEnabled).toBe(true);
  });

  it('stays off below the threshold', () => {
    const testAgent = agent('query:string -> answer:string', {
      runtime,
      functions: smallFunctions,
    });
    expect((testAgent.executor as any).functionDiscoveryEnabled).toBe(false);
  });

  it('honors a tuned threshold', () => {
    const testAgent = agent('query:string -> answer:string', {
      runtime,
      functions: smallFunctions,
      autoUpgrade: { functionDiscovery: { aboveFunctionDocChars: 5 } },
    });
    expect((testAgent.executor as any).functionDiscoveryEnabled).toBe(true);
  });

  it('never overrides an explicit functionDiscovery setting', () => {
    const explicitOff = agent('query:string -> answer:string', {
      runtime,
      functions: makeBigCatalog(),
      functionDiscovery: false,
    });
    expect((explicitOff.executor as any).functionDiscoveryEnabled).toBe(false);

    const explicitOn = agent('query:string -> answer:string', {
      runtime,
      functions: smallFunctions,
      functionDiscovery: true,
      autoUpgrade: false,
    });
    expect((explicitOn.executor as any).functionDiscoveryEnabled).toBe(true);
  });

  it('stays off when autoUpgrade is disabled', () => {
    const testAgent = agent('query:string -> answer:string', {
      runtime,
      functions: makeBigCatalog(),
      autoUpgrade: false,
    });
    expect((testAgent.executor as any).functionDiscoveryEnabled).toBe(false);

    const discoveryOnly = agent('query:string -> answer:string', {
      runtime,
      functions: makeBigCatalog(),
      autoUpgrade: { functionDiscovery: false },
    });
    expect((discoveryOnly.executor as any).functionDiscoveryEnabled).toBe(
      false
    );
  });

  it('skips auto-enable when a `discover` namespace exists', () => {
    const testAgent = agent('query:string -> answer:string', {
      runtime,
      functions: [
        {
          namespace: 'discover',
          title: 'Discover Tools',
          description: 'Namespace that collides with the reserved callable.',
          functions: makeBigCatalog(),
        },
      ],
    });
    expect((testAgent.executor as any).functionDiscoveryEnabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Auto context fields (per-run value promotion)
// ---------------------------------------------------------------------------

describe('autoUpgrade: context fields', () => {
  it('keeps an oversized string runtime-only with a preview, metadata, and events', async () => {
    const capture = makeCapture();
    const events: AxAgentContextEvent[] = [];
    const ai = scriptedAI(
      {
        distiller: ['await final("report bigDoc length", { hint: "ok" })'],
        executor: [
          'console.log("LEN:" + inputs.bigDoc.length)',
          'await final("done", { docChars: inputs.bigDoc.length })',
        ],
        responder: 'Answer: done',
      },
      capture
    );

    const testAgent = agent('bigDoc:string, query:string -> answer:string', {
      runtime: new AxJSRuntime(),
      onContextEvent: (e) => {
        events.push(e as AxAgentContextEvent);
      },
    });

    const result = await testAgent.forward(ai, {
      bigDoc: BIG_DOC,
      query: 'how long is the doc?',
    });
    expect(result.answer).toBe('done');

    // Prompt side: preview + metadata, never the full value.
    const distillerPrompt = capture.distillerPrompts[0] ?? '';
    expect(distillerPrompt).toContain('...[truncated 7810 chars]');
    expect(distillerPrompt).toContain(
      'prompt=inline-truncated(first 1200 chars of 9010)'
    );
    expect(distillerPrompt).toContain('- bigDoc: type=string, size=9010 chars');
    expect(distillerPrompt).not.toContain(NEEDLE);
    for (const prompt of [
      ...capture.executorPrompts,
      ...capture.responderPrompts,
    ]) {
      expect(prompt).not.toContain(NEEDLE);
    }
    expect(capture.responderPrompts[0]).toContain('...[truncated 7810 chars]');

    // Runtime side: the full value is live as inputs.bigDoc.
    expect(capture.executorPrompts[1]).toContain('LEN:9010');

    // Observability: one event per stage for the field.
    const promoted = promotionEvents(events);
    expect(
      promoted.filter(
        (e) => e.fieldName === 'bigDoc' && e.stage === 'distiller'
      )
    ).toHaveLength(1);
    expect(
      promoted.filter((e) => e.fieldName === 'bigDoc' && e.stage === 'executor')
    ).toHaveLength(1);
    expect(promoted[0]?.originalChars).toBe(9010);
    expect(promoted[0]?.promptPreviewChars).toBe(
      DEFAULT_AUTO_CONTEXT_PREVIEW_CHARS
    );
  });

  it('leaves small values inline and emits no events', async () => {
    const capture = makeCapture();
    const events: AxAgentContextEvent[] = [];
    const ai = scriptedAI(
      {
        distiller: ['await final("answer", { hint: "ok" })'],
        executor: ['await final("done", { data: "done" })'],
      },
      capture
    );
    const testAgent = agent('note:string, query:string -> answer:string', {
      runtime: new AxJSRuntime(),
      onContextEvent: (e) => {
        events.push(e as AxAgentContextEvent);
      },
    });
    await testAgent.forward(ai, { note: 'short note', query: 'q' });

    expect(capture.distillerPrompts[0]).toContain('short note');
    expect(capture.distillerPrompts[0]).not.toContain('[truncated');
    expect(promotionEvents(events)).toHaveLength(0);
  });

  it('honors tuned thresholds', async () => {
    const capture = makeCapture();
    const events: AxAgentContextEvent[] = [];
    const ai = scriptedAI(
      {
        distiller: ['await final("answer", { hint: "ok" })'],
        executor: ['await final("done", { data: "done" })'],
      },
      capture
    );
    const testAgent = agent('note:string, query:string -> answer:string', {
      runtime: new AxJSRuntime(),
      autoUpgrade: {
        contextFields: { promoteAboveChars: 100, previewChars: 10 },
      },
      onContextEvent: (e) => {
        events.push(e as AxAgentContextEvent);
      },
    });
    await testAgent.forward(ai, { note: 'n'.repeat(150), query: 'q' });

    expect(capture.distillerPrompts[0]).toContain(
      `${'n'.repeat(10)}...[truncated 140 chars]`
    );
    const promoted = promotionEvents(events);
    expect(promoted[0]?.fieldName).toBe('note');
    expect(promoted[0]?.originalChars).toBe(150);
    expect(promoted[0]?.promptPreviewChars).toBe(10);
  });

  it('keeps declared contextFields on their declared config', async () => {
    const capture = makeCapture();
    const events: AxAgentContextEvent[] = [];
    const ai = scriptedAI(
      {
        distiller: ['await final("answer", { hint: "ok" })'],
        executor: ['await final("done", { data: "done" })'],
      },
      capture
    );
    const testAgent = agent('doc:string, query:string -> answer:string', {
      runtime: new AxJSRuntime(),
      contextFields: [{ field: 'doc', keepInPromptChars: 5 }],
      onContextEvent: (e) => {
        events.push(e as AxAgentContextEvent);
      },
    });
    await testAgent.forward(ai, {
      doc: `ABCDE${'x'.repeat(9000)}`,
      query: 'q',
    });

    // Declared truncate config (5 chars) wins over the auto preview (1200).
    expect(capture.distillerPrompts[0]).toContain(
      'ABCDE...[truncated 9000 chars]'
    );
    expect(promotionEvents(events)).toHaveLength(0);
  });

  it('never promotes the pipeline-owned executorRequest field', async () => {
    const capture = makeCapture();
    const events: AxAgentContextEvent[] = [];
    const bigRequest = 'R'.repeat(9000);
    const ai = scriptedAI(
      {
        distiller: [`await final("${bigRequest}", { hint: "ok" })`],
        executor: ['await final("done", { data: "done" })'],
      },
      capture
    );
    const testAgent = agent('query:string -> answer:string', {
      runtime: new AxJSRuntime(),
      onContextEvent: (e) => {
        events.push(e as AxAgentContextEvent);
      },
    });
    await testAgent.forward(ai, { query: 'q' });

    expect(
      promotionEvents(events).filter((e) => e.fieldName === 'executorRequest')
    ).toHaveLength(0);
    // The expanded request reaches the executor prompt in full.
    expect(capture.executorPrompts[0]).toContain(bigRequest);
  });

  it('keeps an oversized optional array runtime-only with shape metadata', async () => {
    const capture = makeCapture();
    const events: AxAgentContextEvent[] = [];
    const records = Array.from({ length: 200 }, (_, i) => ({
      id: i,
      name: i === 150 ? NEEDLE : `record-${i}-${'r'.repeat(30)}`,
    }));
    const ai = scriptedAI(
      {
        distiller: ['await final("count records", { hint: "ok" })'],
        executor: ['await final("done", { count: inputs.records.length })'],
      },
      capture
    );
    const testAgent = agent('records?:json[], query:string -> answer:string', {
      runtime: new AxJSRuntime(),
      onContextEvent: (e) => {
        events.push(e as AxAgentContextEvent);
      },
    });
    const result = await testAgent.forward(ai, {
      records,
      query: 'how many records?',
    });
    expect(result.answer).toBe('ok');

    const distillerPrompt = capture.distillerPrompts[0] ?? '';
    expect(distillerPrompt).not.toContain(NEEDLE);
    expect(distillerPrompt).toContain(
      '- records: type=array, size=200 items, prompt=runtime-only'
    );
    expect(distillerPrompt).toContain('item keys: id, name');

    const promoted = promotionEvents(events).filter(
      (e) => e.fieldName === 'records'
    );
    expect(promoted.length).toBeGreaterThan(0);
    expect(promoted[0]?.promptPreviewChars).toBeUndefined();
  });

  it('leaves an oversized required array inline (skip mode)', async () => {
    const capture = makeCapture();
    const events: AxAgentContextEvent[] = [];
    const records = Array.from({ length: 200 }, (_, i) => ({
      id: i,
      name: i === 150 ? NEEDLE : `record-${i}-${'r'.repeat(30)}`,
    }));
    const ai = scriptedAI(
      {
        distiller: ['await final("count records", { hint: "ok" })'],
        executor: ['await final("done", { data: "done" })'],
      },
      capture
    );
    const testAgent = agent('records:json[], query:string -> answer:string', {
      runtime: new AxJSRuntime(),
      onContextEvent: (e) => {
        events.push(e as AxAgentContextEvent);
      },
    });
    await testAgent.forward(ai, { records, query: 'q' });

    // Required non-string fields cannot take a preview — value stays inline.
    expect(capture.distillerPrompts[0]).toContain(NEEDLE);
    expect(promotionEvents(events)).toHaveLength(0);
  });

  it('renders a stringified preview for an oversized scalar json object', async () => {
    const capture = makeCapture();
    const events: AxAgentContextEvent[] = [];
    const payload = {
      pad: 'a'.repeat(4000),
      secret: NEEDLE,
      more: 'b'.repeat(5000),
    };
    const ai = scriptedAI(
      {
        distiller: ['await final("inspect payload", { hint: "ok" })'],
        executor: [
          'await final("done", { keys: Object.keys(inputs.payload) })',
        ],
      },
      capture
    );
    const testAgent = agent('payload:json, query:string -> answer:string', {
      runtime: new AxJSRuntime(),
      onContextEvent: (e) => {
        events.push(e as AxAgentContextEvent);
      },
    });
    const result = await testAgent.forward(ai, { payload, query: 'q' });
    expect(result.answer).toBe('ok');

    const distillerPrompt = capture.distillerPrompts[0] ?? '';
    expect(distillerPrompt).toContain('...[truncated');
    expect(distillerPrompt).toContain(
      'prompt=inline-truncated stringified(first 1200 chars)'
    );
    expect(distillerPrompt).not.toContain(NEEDLE);
    expect(
      promotionEvents(events).filter((e) => e.fieldName === 'payload').length
    ).toBeGreaterThan(0);
  });

  it('restores legacy behavior with autoUpgrade: false', async () => {
    const capture = makeCapture();
    const events: AxAgentContextEvent[] = [];
    const ai = scriptedAI(
      {
        distiller: ['await final("answer", { hint: "ok" })'],
        executor: ['await final("done", { data: "done" })'],
      },
      capture
    );
    const testAgent = agent('bigDoc:string, query:string -> answer:string', {
      runtime: new AxJSRuntime(),
      autoUpgrade: false,
      onContextEvent: (e) => {
        events.push(e as AxAgentContextEvent);
      },
    });
    await testAgent.forward(ai, { bigDoc: BIG_DOC, query: 'q' });

    // Full value inlined everywhere, no metadata channel, no events.
    expect(capture.distillerPrompts[0]).toContain(NEEDLE);
    expect(capture.distillerPrompts[0]).not.toContain('[truncated');
    expect(promotionEvents(events)).toHaveLength(0);
  });

  it('does not mutate instance state across forwards', async () => {
    const capture = makeCapture();
    const events: AxAgentContextEvent[] = [];
    const makeAI = () =>
      scriptedAI(
        {
          distiller: ['await final("answer", { hint: "ok" })'],
          executor: ['await final("done", { data: "done" })'],
        },
        capture
      );
    const testAgent = agent('note:string, query:string -> answer:string', {
      runtime: new AxJSRuntime(),
      onContextEvent: (e) => {
        events.push(e as AxAgentContextEvent);
      },
    });

    await testAgent.forward(makeAI(), { note: 'n'.repeat(9000), query: 'q' });
    expect(promotionEvents(events)).toHaveLength(2); // distiller + executor
    expect((testAgent.distiller as any).contextPromptConfigByField.size).toBe(
      0
    );

    events.length = 0;
    await testAgent.forward(makeAI(), { note: 'small', query: 'q' });
    expect(promotionEvents(events)).toHaveLength(0);
  });

  it('substitutes the responder preview on the streaming path too', async () => {
    const capture = makeCapture();
    const ai = scriptedAI(
      {
        distiller: ['await final("report length", { hint: "ok" })'],
        executor: ['await final("done", { docChars: inputs.bigDoc.length })'],
        responder: 'Answer: streamed',
      },
      capture
    );
    const testAgent = agent('bigDoc:string, query:string -> answer:string', {
      runtime: new AxJSRuntime(),
    });

    const chunks: unknown[] = [];
    for await (const chunk of testAgent.streamingForward(ai, {
      bigDoc: BIG_DOC,
      query: 'q',
    })) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBeGreaterThan(0);
    expect(capture.responderPrompts[0]).toContain('...[truncated 7810 chars]');
    expect(capture.responderPrompts[0]).not.toContain(NEEDLE);
  });
});
