import { describe, expect, it } from 'vitest';
import { AxMockAIService } from '../ai/mock/api.js';
import { AxJSRuntime } from '../funcs/jsRuntime.js';
import { AX_HOST_SNIPPET_MARKER } from './agentInternal/sharedSession.js';
import { agent } from './index.js';
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
 * Scripted NON-JavaScript runtime: the only population that takes the
 * per-stage fallback (its sessions cannot run the JS boundary snippets).
 * REPL-faithful: patchGlobals merges, host snippets are skipped by marker,
 * and per-session globals are captured for assertions.
 */
function scriptedLuaRuntime(): {
  runtime: AxCodeRuntime;
  sessions: { globals: Record<string, unknown> | undefined }[];
} {
  const sessions: { globals: Record<string, unknown> | undefined }[] = [];
  const runtime: AxCodeRuntime = {
    language: 'Lua',
    getUsageInstructions: () => '',
    createSession(globals) {
      const record = { globals };
      sessions.push(record);
      return {
        execute: async (code: string) => {
          if (code.startsWith(AX_HOST_SNIPPET_MARKER)) return 'host';
          const g = record.globals;
          if (g?.final && code.includes('final(')) {
            const match = code.match(/final\("([^"]*)"(?:,\s*(\{.*\}))?\)/s);
            if (match) {
              const extra = match[2] ? JSON.parse(match[2]) : undefined;
              (g.final as (...args: unknown[]) => void)(
                match[1],
                ...(extra === undefined ? [] : [extra])
              );
            }
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

// ---------------------------------------------------------------------------
// Shared runtime session across the distiller → executor phase boundary
// ---------------------------------------------------------------------------

describe('shared runtime session pipeline', () => {
  it('carries distiller variables and evidence by reference into the executor phase in ONE session', async () => {
    const capture = makeCapture();
    const { runtime, counts } = countingRuntime();
    const ai = scriptedAI(
      {
        distiller: [
          'matched = inputs.docs.filter((d) => d.tag === "keep").map((d) => ({ id: d.id })); await final("Report how many matched docs there are and their ids", { matched })',
        ],
        executor: [
          'await final("Report the matched docs", { count: inputs.distilledContext.matched.length, ids: inputs.distilledContext.matched.map((m) => m.id), viaVariable: matched.length })',
        ],
        responder: 'Answer: 2 docs',
      },
      capture
    );

    const myAgent = agent('docs:json[], query:string -> answer:string', {
      contextFields: ['docs'],
      runtime,
    });

    const result = await myAgent.forward(ai, {
      docs: DOCS,
      query: 'Which docs are kept?',
    });

    expect(result.answer).toBe('2 docs');
    // One worker session spans both phases.
    expect(counts.sessions).toBe(1);

    // The executor prompt carries only the evidence shape summary — never the
    // materialized evidence or the raw context.
    const executorPrompt = capture.executorPrompts.join('\n');
    expect(executorPrompt).toContain('Distilled Context Summary');
    expect(executorPrompt).toContain('inputs.distilledContext');
    expect(executorPrompt).toContain('`matched`');
    expect(executorPrompt).not.toContain('alpha-secret');
    expect(executorPrompt).not.toContain('a1');

    // The executor read the evidence in-runtime (both via
    // inputs.distilledContext and via the distiller's live variable) and the
    // responder received the materialized values.
    const responderPrompt = capture.responderPrompts.join('\n');
    expect(responderPrompt).toContain('"count": 2');
    expect(responderPrompt).toContain('"viaVariable": 2');
    expect(responderPrompt).toContain('a1');
    expect(responderPrompt).toContain('c3');
  });

  it('keeps raw context fields readable in the executor phase as fallback', async () => {
    const capture = makeCapture();
    const { runtime } = countingRuntime();
    const ai = scriptedAI(
      {
        distiller: [
          'await final("Count the docs tagged keep and report the tag of the first doc", {})',
        ],
        executor: [
          'await final("Report the doc stats", { total: inputs.docs.length, firstTag: inputs.docs[0].tag })',
        ],
        responder: 'Answer: 3 docs',
      },
      capture
    );

    const myAgent = agent('docs:json[], query:string -> answer:string', {
      contextFields: ['docs'],
      runtime,
    });

    const result = await myAgent.forward(ai, {
      docs: DOCS,
      query: 'How many docs?',
    });

    expect(result.answer).toBe('3 docs');
    const responderPrompt = capture.responderPrompts.join('\n');
    expect(responderPrompt).toContain('"total": 3');
    expect(responderPrompt).toContain('"firstTag": "keep"');
  });

  it('gates tools in the distiller phase and dispatches them in the executor phase', async () => {
    const capture = makeCapture();
    const { runtime } = countingRuntime();
    const lookupCalls: unknown[] = [];
    const lookup = {
      name: 'lookup',
      description: 'Look something up',
      parameters: {
        type: 'object' as const,
        properties: { q: { type: 'string' } },
        required: ['q'],
      },
      func: async (args: unknown) => {
        lookupCalls.push(args);
        return 'lookup-result';
      },
    };

    const ai = scriptedAI(
      {
        distiller: [
          'console.log(await utils.lookup({ q: "answer" }))',
          'await final("Look up the answer for the user query and report it", {})',
        ],
        executor: [
          'found = await utils.lookup({ q: "answer" }); await final("Report the lookup result", { found })',
        ],
        responder: 'Answer: found',
      },
      capture
    );

    const myAgent = agent('docs:json[], query:string -> answer:string', {
      contextFields: ['docs'],
      functions: [lookup],
      runtime,
    });

    const result = await myAgent.forward(ai, {
      docs: DOCS,
      query: 'look it up',
    });

    expect(result.answer).toBe('found');
    // The distiller's attempt threw the phase-gate error in-turn (visible in
    // its next prompt's action log) and never reached the real function.
    const distillerSecondPrompt = capture.distillerPrompts[1] ?? '';
    expect(distillerSecondPrompt).toContain('executes in the executor stage');
    expect(lookupCalls).toHaveLength(1);
    const responderPrompt = capture.responderPrompts.join('\n');
    expect(responderPrompt).toContain('lookup-result');
  });

  it('carries distiller discovery docs into the executor prompt', async () => {
    const capture = makeCapture();
    const { runtime } = countingRuntime();
    const dbLookup = {
      name: 'findOrder',
      description: 'Find an order by id',
      namespace: 'db',
      parameters: {
        type: 'object' as const,
        properties: { orderId: { type: 'string' } },
        required: ['orderId'],
      },
      func: async () => ({ status: 'shipped' }),
    };

    const ai = scriptedAI(
      {
        distiller: [
          "await discover('db')",
          'await final("Look up order o-42 with db.findOrder and report its status", { orderId: "o-42" })',
        ],
        executor: [
          'order = await db.findOrder({ orderId: inputs.distilledContext.orderId }); await final("Report the order status", { order })',
        ],
        responder: 'Answer: shipped',
      },
      capture
    );

    const myAgent = agent('docs:json[], query:string -> answer:string', {
      contextFields: ['docs'],
      functions: [dbLookup],
      functionDiscovery: true,
      runtime,
    });

    const result = await myAgent.forward(ai, {
      docs: DOCS,
      query: 'status of order o-42?',
    });

    expect(result.answer).toBe('shipped');
    // The distiller saw the discovered docs on its second turn…
    const distillerSecondPrompt = capture.distillerPrompts[1] ?? '';
    expect(distillerSecondPrompt).toContain('Discovered Tool Docs');
    expect(distillerSecondPrompt).toContain('Module `db`');
    expect(distillerSecondPrompt).toContain('`findOrder`');
    // …and the executor started with them pre-populated (no re-discovery).
    const executorFirstPrompt = capture.executorPrompts[0] ?? '';
    expect(executorFirstPrompt).toContain('Discovered Tool Docs');
    expect(executorFirstPrompt).toContain('Module `db`');
    expect(executorFirstPrompt).toContain('`findOrder`');
  });

  it('merges executor input updates per key without clobbering worker-resident context', async () => {
    const capture = makeCapture();
    const { runtime } = countingRuntime();
    const ai = scriptedAI(
      {
        distiller: [
          'await final("Answer the (possibly updated) query using the docs", {})',
        ],
        executor: [
          'await final("Report the query and context state", { query: inputs.query, docCount: inputs.docs.length })',
        ],
        responder: 'Answer: merged',
      },
      capture
    );

    const myAgent = agent('docs:json[], query:string -> answer:string', {
      contextFields: ['docs'],
      runtime,
      inputUpdateCallback: async () => ({ query: 'updated-query' }),
    });

    const result = await myAgent.forward(ai, {
      docs: DOCS,
      query: 'original-query',
    });

    expect(result.answer).toBe('merged');
    const responderPrompt = capture.responderPrompts.join('\n');
    // The per-key merge delivered the updated input value…
    expect(responderPrompt).toContain('"query": "updated-query"');
    // …without deleting the worker-resident context field.
    expect(responderPrompt).toContain('"docCount": 3');
  });

  it('bounces oversized executor evidence in-turn so the actor can narrow and retry', async () => {
    const capture = makeCapture();
    const { runtime } = countingRuntime();
    const ai = scriptedAI(
      {
        distiller: ['await final("Produce the summary", {})'],
        executor: [
          'await final("Report the payload", { big: "x".repeat(500) })',
          'await final("Report the payload", { small: "ok" })',
        ],
        responder: 'Answer: narrowed',
      },
      capture
    );

    const myAgent = agent('docs:json[], query:string -> answer:string', {
      contextFields: ['docs'],
      runtime,
      maxEvidenceChars: 120,
    });

    const result = await myAgent.forward(ai, {
      docs: DOCS,
      query: 'summarize',
    });

    expect(result.answer).toBe('narrowed');
    // Turn 1's oversized evidence surfaced as an in-turn error…
    const executorSecondPrompt = capture.executorPrompts[1] ?? '';
    expect(executorSecondPrompt).toContain('evidence is too large');
    // …and the narrowed retry reached the responder.
    const responderPrompt = capture.responderPrompts.join('\n');
    expect(responderPrompt).toContain('"small": "ok"');
    expect(responderPrompt).not.toContain('xxxxxxxxxx');
  });

  it('streams through the same shared-session handoff', async () => {
    const capture = makeCapture();
    const { runtime, counts } = countingRuntime();
    const ai = scriptedAI(
      {
        distiller: [
          'matched = inputs.docs.filter((d) => d.tag === "keep"); await final("Report the matched docs", { matched })',
        ],
        executor: [
          'await final("Report the matched docs", { count: matched.length })',
        ],
        responder: 'Answer: streamed',
      },
      capture
    );

    const myAgent = agent('docs:json[], query:string -> answer:string', {
      contextFields: ['docs'],
      runtime,
    });

    let answer = '';
    for await (const chunk of myAgent.streamingForward(ai, {
      docs: DOCS,
      query: 'stream it',
    })) {
      const delta = (chunk.delta as { answer?: string })?.answer;
      if (typeof delta === 'string') answer += delta;
    }

    expect(answer).toBe('streamed');
    expect(counts.sessions).toBe(1);
    const executorPrompt = capture.executorPrompts.join('\n');
    expect(executorPrompt).toContain('Distilled Context Summary');
    const responderPrompt = capture.responderPrompts.join('\n');
    expect(responderPrompt).toContain('"count": 2');
  });

  it('falls back to per-stage sessions with host-carried evidence for non-JavaScript runtimes', async () => {
    const capture = makeCapture();
    const { runtime, sessions } = scriptedLuaRuntime();

    // Non-JS runtimes render a language-specific code field ("Lua Code").
    let distillerTurns = 0;
    const ai = new AxMockAIService({
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
          capture.distillerPrompts.push(userText);
          distillerTurns++;
          return respond(
            'Lua Code: final("Report the matched docs", {"matched":[{"id":"a1"},{"id":"c3"}]})'
          );
        }
        if (systemPrompt.includes('You (`executor`)')) {
          capture.executorPrompts.push(userText);
          return respond(
            'Lua Code: final("Report the matched docs", {"count":2,"ids":["a1","c3"]})'
          );
        }
        capture.responderPrompts.push(userText);
        return respond('Answer: fallback-ok');
      },
    });

    const myAgent = agent('docs:json[], query:string -> answer:string', {
      contextFields: ['docs'],
      runtime,
    });

    const result = await myAgent.forward(ai, {
      docs: DOCS,
      query: 'Which docs are kept?',
    });

    expect(result.answer).toBe('fallback-ok');
    expect(distillerTurns).toBe(1);
    // Two sessions (one per stage): the evidence crossed through the host…
    expect(sessions).toHaveLength(2);
    // …into the executor's runtime globals (inputs entry + bare alias)…
    const executorGlobals = sessions[1]?.globals as
      | Record<string, unknown>
      | undefined;
    const executorInputs = executorGlobals?.inputs as
      | Record<string, unknown>
      | undefined;
    expect(executorInputs?.distilledContext).toEqual({
      matched: [{ id: 'a1' }, { id: 'c3' }],
    });
    expect(executorGlobals?.distilledContext).toEqual({
      matched: [{ id: 'a1' }, { id: 'c3' }],
    });
    // …while its prompt carries only the shape summary, never the payload.
    const executorPrompt = capture.executorPrompts.join('\n');
    expect(executorPrompt).toContain('Distilled Context Summary');
    expect(executorPrompt).toContain('`matched`');
    expect(executorPrompt).not.toContain('alpha-secret');
    expect(executorPrompt).not.toContain('"a1"');
    const responderPrompt = capture.responderPrompts.join('\n');
    expect(responderPrompt).toContain('"count": 2');
    expect(responderPrompt).toContain('a1');
  });
});
