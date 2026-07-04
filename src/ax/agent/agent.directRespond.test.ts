import { describe, expect, it, vi } from 'vitest';
import { AxMockAIService } from '../ai/mock/api.js';
import { AxJSRuntime } from '../funcs/jsRuntime.js';
import { buildDirectRespondExecutorRun } from './agentInternal/pipelineForward.js';
import { AX_HOST_SNIPPET_MARKER } from './agentInternal/sharedSession.js';
import { AxAgentContextMap } from './contextMap.js';
import { AxAgentClarificationError, agent } from './index.js';
import type { AxCodeRuntime } from './rlm.js';

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
  executor?: string[];
  responder?: string;
};

type PromptCapture = {
  distillerSystemPrompts: string[];
  distillerPrompts: string[];
  executorSystemPrompts: string[];
  executorPrompts: string[];
  responderPrompts: string[];
};

const makeCapture = (): PromptCapture => ({
  distillerSystemPrompts: [],
  distillerPrompts: [],
  executorSystemPrompts: [],
  executorPrompts: [],
  responderPrompts: [],
});

/**
 * Scripted mock model: dispatches on the stage system prompt and pops the
 * stage's next code turn. Captures each stage's system and user prompts.
 * An executor request with no script fails the test — direct-respond runs
 * must never reach the executor model.
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
      const reply = (content: string) => ({
        results: [{ index: 0, content, finishReason: 'stop' as const }],
        modelUsage: makeModelUsage(),
      });
      if (systemPrompt.includes('You (`distiller`)')) {
        capture?.distillerSystemPrompts.push(systemPrompt);
        capture?.distillerPrompts.push(userText);
        const code =
          scripts.distiller[
            Math.min(distillerTurn, scripts.distiller.length - 1)
          ];
        distillerTurn++;
        return reply(`Javascript Code: ${code}`);
      }
      if (systemPrompt.includes('You (`executor`)')) {
        if (!scripts.executor || scripts.executor.length === 0) {
          throw new Error(
            'executor stage was called but the test scripted no executor turns'
          );
        }
        capture?.executorSystemPrompts.push(systemPrompt);
        capture?.executorPrompts.push(userText);
        const code =
          scripts.executor[Math.min(executorTurn, scripts.executor.length - 1)];
        executorTurn++;
        return reply(`Javascript Code: ${code}`);
      }
      if (systemPrompt.includes('Answer Synthesis Agent')) {
        capture?.responderPrompts.push(userText);
        return reply(scripts.responder ?? 'Answer: ok');
      }
      return reply('Answer: fallback');
    },
  });
}

/** Real worker runtime behind a session-counting proxy. */
function countingRuntime(): {
  runtime: AxCodeRuntime;
  counts: { sessions: number };
} {
  const real = new AxJSRuntime();
  const counts = { sessions: 0 };
  const runtime: AxCodeRuntime = {
    language: 'JavaScript',
    getUsageInstructions: () => real.getUsageInstructions(),
    createSession: (globals, sessionOptions) => {
      counts.sessions++;
      return real.createSession(globals, sessionOptions);
    },
  };
  return { runtime, counts };
}

/**
 * Scripted NON-JavaScript runtime (fallback mode: per-stage sessions).
 * REPL-faithful: patchGlobals merges, host snippets are skipped by marker,
 * and `final(`/`respond(` calls are parsed and dispatched to the host
 * bindings so completion payloads flow exactly like a real engine.
 */
function scriptedLuaRuntime(): {
  runtime: AxCodeRuntime;
  sessions: { globals: Record<string, unknown> | undefined }[];
} {
  const sessions: { globals: Record<string, unknown> | undefined }[] = [];
  const dispatchCompletion = (
    g: Record<string, unknown> | undefined,
    code: string,
    fnName: 'final' | 'respond'
  ): boolean => {
    const binding = g?.[fnName];
    if (typeof binding !== 'function' || !code.includes(`${fnName}(`)) {
      return false;
    }
    const match = code.match(
      new RegExp(`${fnName}\\("([^"]*)"(?:,\\s*(\\{.*\\}))?\\)`, 's')
    );
    if (!match) return false;
    const extra = match[2] ? JSON.parse(match[2]) : undefined;
    (binding as (...args: unknown[]) => void)(
      match[1],
      ...(extra === undefined ? [] : [extra])
    );
    return true;
  };
  const runtime: AxCodeRuntime = {
    language: 'Lua',
    getUsageInstructions: () => '',
    createSession(globals) {
      const record = { globals };
      sessions.push(record);
      return {
        execute: async (code: string) => {
          if (code.startsWith(AX_HOST_SNIPPET_MARKER)) return 'host';
          if (dispatchCompletion(record.globals, code, 'respond')) {
            return 'submitted';
          }
          if (dispatchCompletion(record.globals, code, 'final')) {
            return 'submitted';
          }
          return 'executed';
        },
        patchGlobals: async (patch) => {
          Object.assign(record.globals ?? {}, patch);
        },
        close: () => {},
      };
    },
  };
  return { runtime, sessions };
}

const DOCS = [
  { id: 'a1', tag: 'keep', body: 'alpha-secret content one' },
  { id: 'b2', tag: 'drop', body: 'alpha-secret content two' },
  { id: 'c3', tag: 'keep', body: 'alpha-secret content three' },
];

/** A registered tool so the agent runs in DYNAMIC direct-respond mode. */
const VENDOR_TOOL = {
  name: 'getVendor',
  description: 'Fetch the live vendor record by id from the ERP system.',
  namespace: 'erp',
  parameters: {
    type: 'object' as const,
    properties: { vendorId: { type: 'string' as const, description: 'id' } },
    required: ['vendorId'],
  },
  func: async () => ({ vendorId: 'v1', status: 'active' }),
};

// ---------------------------------------------------------------------------
// Direct-respond: distiller-signaled executor skip
// ---------------------------------------------------------------------------

describe('direct-respond executor skip', () => {
  it('dynamic mode, shared session: respond() skips the executor and materializes evidence into the responder prompt', async () => {
    const capture = makeCapture();
    const { runtime, counts } = countingRuntime();
    const ai = scriptedAI(
      {
        distiller: [
          'matched = inputs.docs.filter((d) => d.tag === "keep").map((d) => ({ id: d.id })); await respond("Report the kept docs and their count", { matched })',
        ],
        responder: 'Answer: 2 kept docs',
      },
      capture
    );

    const myAgent = agent('docs:json[], query:string -> answer:string', {
      contextFields: ['docs'],
      runtime,
      functions: [VENDOR_TOOL],
    });

    const result = await myAgent.forward(ai, {
      docs: DOCS,
      query: 'Which docs are kept?',
    });

    expect(result.answer).toBe('2 kept docs');
    // Zero executor model calls, one worker session.
    expect(capture.executorPrompts).toHaveLength(0);
    expect(counts.sessions).toBe(1);

    // The evidence crossed the worker boundary as real values and landed in
    // the responder prompt (unlike final(), which keeps it in-session).
    const responderPrompt = capture.responderPrompts.join('\n');
    expect(responderPrompt).toContain('Report the kept docs and their count');
    expect(responderPrompt).toContain('a1');
    expect(responderPrompt).toContain('c3');
    expect(responderPrompt).not.toContain('alpha-secret');
  });

  it('fallback mode (non-JS runtime): respond() skips the executor with per-stage sessions', async () => {
    const capture = makeCapture();
    const { runtime, sessions } = scriptedLuaRuntime();
    const ai = scriptedAI(
      {
        distiller: ['respond("Report the doc total", {"total": 3})'],
        responder: 'Answer: 3 docs',
      },
      capture
    );

    const myAgent = agent('docs:json[], query:string -> answer:string', {
      contextFields: ['docs'],
      runtime,
      functions: [VENDOR_TOOL],
    });

    const result = await myAgent.forward(ai, {
      docs: DOCS,
      query: 'How many docs?',
    });

    expect(result.answer).toBe('3 docs');
    expect(capture.executorPrompts).toHaveLength(0);
    // Only the distiller's session was ever created.
    expect(sessions).toHaveLength(1);
    expect(capture.responderPrompts.join('\n')).toContain('"total": 3');
  });

  it('static agent (no functions): respond replaces final in the distiller prompt', async () => {
    const capture = makeCapture();
    const { runtime } = countingRuntime();
    const ai = scriptedAI(
      {
        distiller: ['await respond("Answer the question", { note: "ok" })'],
        responder: 'Answer: ok',
      },
      capture
    );

    const myAgent = agent('docs:json[], query:string -> answer:string', {
      contextFields: ['docs'],
      runtime,
    });

    await myAgent.forward(ai, { docs: DOCS, query: 'q' });

    const sys = capture.distillerSystemPrompts[0] ?? '';
    // Static preamble + respond as THE completion primitive.
    expect(sys).toContain('There is no executor phase');
    expect(sys).toContain('await respond(task: string, evidence?: object)');
    // The final() primitive block is hidden (disabledBy: directRespondOnly).
    expect(sys).not.toContain('await final(task: string, context?: object)');
    // The dynamic covenant section does not render in static mode.
    expect(sys).not.toContain('### Direct Response');
  });

  it('static agent end-to-end: two model stages, answer from evidence', async () => {
    const capture = makeCapture();
    const { runtime, counts } = countingRuntime();
    const ai = scriptedAI(
      {
        distiller: [
          'kept = inputs.docs.filter((d) => d.tag === "keep"); await respond("Report how many docs are kept", { count: kept.length })',
        ],
        responder: 'Answer: 2',
      },
      capture
    );

    const myAgent = agent('docs:json[], query:string -> answer:string', {
      contextFields: ['docs'],
      runtime,
    });

    const result = await myAgent.forward(ai, { docs: DOCS, query: 'q' });

    expect(result.answer).toBe('2');
    expect(capture.distillerPrompts.length).toBeGreaterThanOrEqual(1);
    expect(capture.executorPrompts).toHaveLength(0);
    expect(capture.responderPrompts).toHaveLength(1);
    expect(counts.sessions).toBe(1);
    expect(capture.responderPrompts.join('\n')).toContain('"count": 2');
  });

  it('no-skip control: a dynamic distiller ending with final() still runs the executor', async () => {
    const capture = makeCapture();
    const { runtime, counts } = countingRuntime();
    const ai = scriptedAI(
      {
        distiller: [
          'await final("Fetch vendor v1 and report its status", { vendorId: "v1" })',
        ],
        executor: [
          'const v = await erp.getVendor({ vendorId: inputs.distilledContext.vendorId }); await final("Report the vendor status", { status: v.status })',
        ],
        responder: 'Answer: active',
      },
      capture
    );

    const myAgent = agent('docs:json[], query:string -> answer:string', {
      contextFields: ['docs'],
      runtime,
      functions: [VENDOR_TOOL],
    });

    const result = await myAgent.forward(ai, {
      docs: DOCS,
      query: 'What is the status of vendor v1?',
    });

    expect(result.answer).toBe('active');
    expect(capture.executorPrompts.length).toBeGreaterThanOrEqual(1);
    expect(counts.sessions).toBe(1);
    expect(capture.responderPrompts.join('\n')).toContain('"status": "active"');
  });

  it('budgets respond() evidence: oversized evidence throws in-turn and the actor narrows and retries', async () => {
    const capture = makeCapture();
    const { runtime } = countingRuntime();
    const ai = scriptedAI(
      {
        distiller: [
          'await respond("Answer the question", { big: "x".repeat(5000) })',
          'await respond("Answer the question", { small: "ok" })',
        ],
        responder: 'Answer: ok',
      },
      capture
    );

    const myAgent = agent('docs:json[], query:string -> answer:string', {
      contextFields: ['docs'],
      runtime,
      maxEvidenceChars: 500,
    });

    const result = await myAgent.forward(ai, { docs: DOCS, query: 'q' });

    expect(result.answer).toBe('ok');
    expect(capture.distillerPrompts).toHaveLength(2);
    expect(capture.distillerPrompts[1]).toContain(
      'respond() evidence is too large'
    );
    expect(capture.executorPrompts).toHaveLength(0);
    expect(capture.responderPrompts.join('\n')).toContain('"small": "ok"');
  });

  it('askClarification from the distiller still throws with direct-respond enabled', async () => {
    const { runtime } = countingRuntime();
    const ai = scriptedAI({
      distiller: ['await askClarification("Which doc should I inspect?")'],
    });

    const myAgent = agent('docs:json[], query:string -> answer:string', {
      contextFields: ['docs'],
      runtime,
      functions: [VENDOR_TOOL],
    });

    await expect(
      myAgent.forward(ai, { docs: DOCS, query: 'q' })
    ).rejects.toThrow(AxAgentClarificationError);
  });

  it('exports cross-run state on skip: variables created before respond() are restored into the next run', async () => {
    const capture = makeCapture();
    const { runtime, counts } = countingRuntime();
    let run = 0;
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');
        const reply = (content: string) => ({
          results: [{ index: 0, content, finishReason: 'stop' as const }],
          modelUsage: makeModelUsage(),
        });
        if (systemPrompt.includes('You (`distiller`)')) {
          capture.distillerPrompts.push(
            req.chatPrompt
              .filter((m) => m.role === 'user')
              .map((m) => String(m.content ?? ''))
              .join('\n')
          );
          return reply(
            run === 0
              ? 'Javascript Code: stash = { n: 41 }; await respond("Report that the number was stashed", { stashed: true })'
              : 'Javascript Code: await respond("Report the stashed number", { n: stash.n })'
          );
        }
        if (systemPrompt.includes('You (`executor`)')) {
          throw new Error('executor must not run in this test');
        }
        capture.responderPrompts.push(
          req.chatPrompt
            .filter((m) => m.role === 'user')
            .map((m) => String(m.content ?? ''))
            .join('\n')
        );
        return reply('Answer: ok');
      },
    });

    const myAgent = agent('docs:json[], query:string -> answer:string', {
      contextFields: ['docs'],
      runtime,
    });

    await myAgent.forward(ai, { docs: DOCS, query: 'stash a number' });
    const stateAfterRun1 = myAgent.getState();
    expect(stateAfterRun1?.runtimeBindings).toMatchObject({
      stash: { n: 41 },
    });

    run = 1;
    await myAgent.forward(ai, { docs: DOCS, query: 'what was stashed?' });
    expect(capture.responderPrompts[1]).toContain('"n": 41');
    // Two runs, one fresh session each.
    expect(counts.sessions).toBe(2);
  });

  it('skip-then-normal: a later run restores respond-exported bindings for the executor phase', async () => {
    const capture = makeCapture();
    const { runtime } = countingRuntime();
    let run = 0;
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');
        const reply = (content: string) => ({
          results: [{ index: 0, content, finishReason: 'stop' as const }],
          modelUsage: makeModelUsage(),
        });
        if (systemPrompt.includes('You (`distiller`)')) {
          return reply(
            run === 0
              ? 'Javascript Code: stash = { n: 41 }; await respond("Report that the number was stashed", { stashed: true })'
              : 'Javascript Code: await final("Report the stashed number", {})'
          );
        }
        if (systemPrompt.includes('You (`executor`)')) {
          return reply(
            'Javascript Code: await final("Report the stashed number", { n: stash.n })'
          );
        }
        capture.responderPrompts.push(
          req.chatPrompt
            .filter((m) => m.role === 'user')
            .map((m) => String(m.content ?? ''))
            .join('\n')
        );
        return reply('Answer: ok');
      },
    });

    const myAgent = agent('docs:json[], query:string -> answer:string', {
      contextFields: ['docs'],
      runtime,
      functions: [VENDOR_TOOL],
    });

    await myAgent.forward(ai, { docs: DOCS, query: 'stash a number' });
    run = 1;
    await myAgent.forward(ai, { docs: DOCS, query: 'what was stashed?' });

    expect(capture.responderPrompts[1]).toContain('"n": 41');
  });

  it('streamingForward: respond() skips the executor and streams the responder only', async () => {
    const capture = makeCapture();
    const { runtime } = countingRuntime();
    const ai = scriptedAI(
      {
        distiller: [
          'kept = inputs.docs.filter((d) => d.tag === "keep"); await respond("Report the kept count", { count: kept.length })',
        ],
        responder: 'Answer: 2 kept',
      },
      capture
    );

    const myAgent = agent('docs:json[], query:string -> answer:string', {
      contextFields: ['docs'],
      runtime,
      functions: [VENDOR_TOOL],
    });

    let lastDelta: Record<string, unknown> = {};
    for await (const chunk of myAgent.streamingForward(ai, {
      docs: DOCS,
      query: 'How many kept?',
    })) {
      lastDelta = { ...lastDelta, ...(chunk.delta as object) };
    }

    expect(lastDelta.answer).toBe('2 kept');
    expect(capture.executorPrompts).toHaveLength(0);
    expect(capture.responderPrompts.join('\n')).toContain('"count": 2');
  });

  it('evaluation path: respond() yields a final prediction with zero function calls', async () => {
    const capture = makeCapture();
    const { runtime } = countingRuntime();
    const ai = scriptedAI(
      {
        distiller: [
          'await respond("Report the kept count", { count: inputs.docs.filter((d) => d.tag === "keep").length })',
        ],
        responder: 'Answer: 2 kept',
      },
      capture
    );

    const myAgent = agent('docs:json[], query:string -> answer:string', {
      contextFields: ['docs'],
      runtime,
      functions: [VENDOR_TOOL],
    }) as any;

    const prediction = await myAgent._forwardForEvaluation(ai, {
      input: { docs: DOCS, query: 'How many kept?' },
    });

    expect(prediction.completionType).toBe('final');
    expect(prediction.output?.answer).toBe('2 kept');
    expect(prediction.functionCalls).toHaveLength(0);
    expect(prediction.turnCount).toBe(1);
    expect(capture.executorPrompts).toHaveLength(0);
  });

  it('updates the contextMap after a skip run with the respond task string', async () => {
    const map = AxAgentContextMap.fromText(
      '## CONTEXT UNDERSTANDING\n[cu-00001] Existing doc orientation.\n'
    );
    const onUpdate = vi.fn();
    const updaterUserPrompts: string[] = [];
    const { runtime } = countingRuntime();
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');
        const userText = req.chatPrompt
          .filter((m) => m.role === 'user')
          .map((m) => String(m.content ?? ''))
          .join('\n');
        const reply = (content: string) => ({
          results: [{ index: 0, content, finishReason: 'stop' as const }],
          modelUsage: makeModelUsage(),
        });
        if (systemPrompt.includes('context-map Distiller')) {
          updaterUserPrompts.push(userText);
          return reply(
            [
              'Diagnosis: Learned the docs are tagged keep/drop.',
              'Item Tags: {"cu-00001":"helpful"}',
              'Cache Candidates: [{"section":"context_understanding","content":"Docs carry a keep/drop tag."}]',
            ].join('\n')
          );
        }
        if (systemPrompt.includes('context-map Cartographer')) {
          return reply(
            'Operations: [{"type":"ADD","section":"context_understanding","content":"Docs carry a keep/drop tag."}]'
          );
        }
        if (systemPrompt.includes('You (`distiller`)')) {
          return reply(
            'Javascript Code: await respond("Report the kept doc count", { count: 2 })'
          );
        }
        if (systemPrompt.includes('You (`executor`)')) {
          throw new Error('executor must not run in this test');
        }
        return reply('Answer: ok');
      },
    });

    const myAgent = agent('docs:json[], query:string -> answer:string', {
      contextFields: ['docs'],
      runtime,
      contextMap: { map, onUpdate },
    });

    const result = await myAgent.forward(ai, {
      docs: DOCS,
      query: 'How many kept?',
    });

    expect(result.answer).toBe('ok');
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0]?.[0]).toMatchObject({ status: 'updated' });
    // The trajectory saw the respond task string as the executor request.
    expect(updaterUserPrompts.join('\n')).toContain(
      'Report the kept doc count'
    );
  });

  it('propagates distiller-declared used memories on a skip run', async () => {
    const onUsedMemories = vi.fn();
    const { runtime } = countingRuntime();
    let distillerTurns = 0;
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');
        const reply = (content: string) => ({
          results: [{ index: 0, content, finishReason: 'stop' as const }],
          modelUsage: makeModelUsage(),
        });
        if (systemPrompt.includes('You (`distiller`)')) {
          distillerTurns += 1;
          return reply(
            distillerTurns === 1
              ? 'Javascript Code: await recall(["coffee"]); console.log("loaded")'
              : 'Javascript Code: await used("coffee", "Personalized the answer"); await respond("Answer with the coffee preference", { pref: "coffee" })'
          );
        }
        if (systemPrompt.includes('You (`executor`)')) {
          throw new Error('executor must not run in this test');
        }
        return reply('Answer: ok');
      },
    });

    const myAgent = agent('query:string -> answer:string', {
      contextFields: [],
      runtime,
      onMemoriesSearch: async () => [
        { id: 'coffee', content: 'User prefers coffee routines.' },
      ],
    });

    await myAgent.forward(
      ai,
      { query: 'Make it personal' },
      { onUsedMemories }
    );

    expect(onUsedMemories).toHaveBeenCalledWith([
      {
        id: 'coffee',
        reason: 'Personalized the answer',
        stage: 'distiller',
      },
    ]);
  });

  it("kill switch: directResponse 'off' removes the primitive and the binding, and the run recovers via final()", async () => {
    const capture = makeCapture();
    const { runtime } = countingRuntime();
    const ai = scriptedAI(
      {
        distiller: [
          'await respond("Answer the question", { note: "ok" })',
          'await final("Answer the question about kept docs", {})',
        ],
        executor: ['await final("Answer the question", { note: "ok" })'],
        responder: 'Answer: ok',
      },
      capture
    );

    const myAgent = agent('docs:json[], query:string -> answer:string', {
      contextFields: ['docs'],
      runtime,
      directResponse: 'off',
    });

    const result = await myAgent.forward(ai, { docs: DOCS, query: 'q' });

    expect(result.answer).toBe('ok');
    // Prompt contract: no respond primitive, final() intact even though the
    // agent has no functions (static shape is disabled by the kill switch).
    const sys = capture.distillerSystemPrompts[0] ?? '';
    expect(sys).not.toContain('respond(task: string');
    expect(sys).toContain('await final(task: string, context?: object)');
    // The stray respond() call was an in-runtime error the actor recovered
    // from, and the executor ran as usual.
    expect(capture.distillerPrompts).toHaveLength(2);
    expect(capture.distillerPrompts[1]).toContain('respond is not defined');
    expect(capture.executorPrompts.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects a respond payload reaching the pipeline while the feature is off', () => {
    const p = { distiller: { directRespondEnabled: false } };
    expect(() =>
      buildDirectRespondExecutorRun(
        p,
        {},
        {
          executorResult: { type: 'respond', args: ['task', {}] },
          nonContextValues: {},
        }
      )
    ).toThrow(/directResponse is 'off'/);
  });

  it('validates the directResponse option value', () => {
    expect(() =>
      agent('query:string -> answer:string', {
        directResponse: 'bogus' as never,
      })
    ).toThrow(/directResponse must be 'auto' or 'off'/);
  });

  it('static agent ingests forward-time skills into the distiller', async () => {
    const capture = makeCapture();
    const { runtime } = countingRuntime();
    const ai = scriptedAI(
      {
        distiller: ['await respond("Answer using the release rules", {})'],
        responder: 'Answer: ok',
      },
      capture
    );

    const myAgent = agent('query:string -> answer:string', {
      contextFields: [],
      runtime,
    });

    await myAgent.forward(
      ai,
      { query: 'How do we cut a release?' },
      {
        skills: [
          {
            id: 'release',
            name: 'Release checklist',
            content: 'Always tag the release with nonce-skill-token-77.',
          },
        ],
      }
    );

    // Loaded skills surface as the actor's `loadedSkills` user-prompt value.
    expect(capture.distillerPrompts[0]).toContain('nonce-skill-token-77');
  });

  it('validates respond() arguments in-turn', async () => {
    const capture = makeCapture();
    const { runtime } = countingRuntime();
    const ai = scriptedAI(
      {
        distiller: [
          'await respond()',
          'await respond("Report the answer", [1, 2])',
          'await respond("Report the answer", { ok: true })',
        ],
        responder: 'Answer: ok',
      },
      capture
    );

    const myAgent = agent('docs:json[], query:string -> answer:string', {
      contextFields: ['docs'],
      runtime,
    });

    const result = await myAgent.forward(ai, { docs: DOCS, query: 'q' });

    expect(result.answer).toBe('ok');
    expect(capture.distillerPrompts).toHaveLength(3);
    expect(capture.distillerPrompts[1]).toContain(
      'respond() requires at least one argument'
    );
    expect(capture.distillerPrompts[2]).toContain(
      'respond() second argument must be a evidence object'
    );
    expect(capture.executorPrompts).toHaveLength(0);
  });

  it('executor phase gets a throwing respond stub (shared session): calling it errors in-turn and final() recovers', async () => {
    const capture = makeCapture();
    const { runtime } = countingRuntime();
    const ai = scriptedAI(
      {
        distiller: ['await final("Report the kept docs", {})'],
        executor: [
          'await respond("Report the kept docs", { count: 2 })',
          'await final("Report the kept docs", { count: 2 })',
        ],
        responder: 'Answer: 2',
      },
      capture
    );

    const myAgent = agent('docs:json[], query:string -> answer:string', {
      contextFields: ['docs'],
      runtime,
      functions: [VENDOR_TOOL],
    });

    const result = await myAgent.forward(ai, { docs: DOCS, query: 'q' });

    expect(result.answer).toBe('2');
    expect(capture.executorPrompts).toHaveLength(2);
    expect(capture.executorPrompts[1]).toContain(
      'respond() is only available in the context (distiller) phase'
    );
  });

  it('dynamic distiller prompt carries the Direct Response covenant', async () => {
    const capture = makeCapture();
    const { runtime } = countingRuntime();
    const ai = scriptedAI(
      {
        distiller: ['await respond("Answer", { ok: true })'],
        responder: 'Answer: ok',
      },
      capture
    );

    const myAgent = agent('docs:json[], query:string -> answer:string', {
      contextFields: ['docs'],
      runtime,
      functions: [VENDOR_TOOL],
    });

    await myAgent.forward(ai, { docs: DOCS, query: 'q' });

    const sys = capture.distillerSystemPrompts[0] ?? '';
    expect(sys).toContain('### Direct Response');
    expect(sys).toContain('current, live, or fresh state');
    expect(sys).toContain('no side effect');
    // Both completion primitives are on offer in dynamic mode.
    expect(sys).toContain('await final(task: string, context?: object)');
    expect(sys).toContain('await respond(task: string, evidence?: object)');
    // The executor-functions section warns against respond when covered.
    expect(sys).toContain('forward with `final()` — never `respond()`');
  });
});
