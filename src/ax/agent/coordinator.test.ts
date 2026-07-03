import { describe, expect, it } from 'vitest';
import { AxMockAIService } from '../ai/mock/api.js';
import {
  AX_HOST_SNIPPET_MARKER,
  AX_INPUTS_PATCH_GLOBAL,
} from './agentInternal/sharedSession.js';
import { AxAgent, AxAgentClarificationError, agent } from './index.js';
import type { AxCodeRuntime } from './rlm.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeModelUsage = () => ({
  ai: 'mock',
  model: 'mock',
  tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
});

/**
 * Minimal runtime factory.  Recognises `final(...)` and `askClarification(...)`
 * calls by pattern-matching the code string, then invokes the matching global.
 * An optional `behavior` callback can override execution for all other code.
 */
const makeRuntime = (
  behavior?: (code: string, globals: Record<string, unknown>) => unknown
): AxCodeRuntime => ({
  getUsageInstructions: () => '',
  createSession(globals) {
    return {
      execute: async (code: string) => {
        if (code.startsWith(AX_HOST_SNIPPET_MARKER)) return 'host-snippet';
        if (globals?.final && code.includes('final(')) {
          // Parse args from final("message", {field: "val"}) or final("message")
          const match = code.match(/final\("([^"]*)"(?:,\s*(\{[^}]*\}))?\)/);
          if (match) {
            const msg = match[1];
            const extra = match[2] ? JSON.parse(match[2]) : {};
            (globals.final as (...args: unknown[]) => void)(msg, extra);
          }
          return 'submitted';
        }
        if (globals?.askClarification && code.includes('askClarification(')) {
          const match = code.match(/askClarification\("([^"]*)"\)/);
          const q = match?.[1] ?? 'what?';
          await (globals.askClarification as (q: string) => Promise<void>)(q);
          return 'clarification requested';
        }
        if (behavior) return behavior(code, globals as Record<string, unknown>);
        return 'executed';
      },
      // REPL-faithful: merge (phase-2 rebinding) + honor staged input merges.
      patchGlobals: async (patch: Record<string, unknown>) => {
        const { [AX_INPUTS_PATCH_GLOBAL]: staged, ...rest } = patch;
        Object.assign(globals ?? {}, rest);
        if (globals && staged && typeof staged === 'object') {
          globals.inputs = Object.assign(
            (globals.inputs as Record<string, unknown>) ?? {},
            staged
          );
        }
      },
      close: () => {},
    };
  },
});

// Simple function tool used in Cases A and C
const simpleFn = {
  name: 'lookup',
  description: 'Look something up',
  parameters: {
    type: 'object' as const,
    properties: { q: { type: 'string' } },
    required: ['q'],
  },
  func: async (_args: unknown) => 'result',
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('AxAgent coordinator routing', () => {
  // -------------------------------------------------------------------------
  // Case A: contextFields + tools → two stages (ctx → task)
  // -------------------------------------------------------------------------

  describe('Case A: contextFields + tools (two-stage)', () => {
    it('routes through ctx then task stages and returns final output', async () => {
      let ctxActorCalls = 0;
      let taskActorCalls = 0;
      let finalResponderCalls = 0;

      const mockAI = new AxMockAIService({
        features: { functions: false, streaming: false },
        chatResponse: async (req) => {
          const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

          // Ctx actor
          if (systemPrompt.includes('You (`distiller`)')) {
            ctxActorCalls++;
            return {
              results: [
                {
                  index: 0,
                  content:
                    'Javascript Code: final("distilled", {"evidence":"summary"})',
                  finishReason: 'stop' as const,
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }

          // Task actor
          if (systemPrompt.includes('You (`executor`)')) {
            taskActorCalls++;
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: final("done", {"answer":"42"})',
                  finishReason: 'stop' as const,
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }

          if (systemPrompt.includes('Answer Synthesis Agent')) {
            finalResponderCalls++;
            return {
              results: [
                {
                  index: 0,
                  content: 'Answer: 42',
                  finishReason: 'stop' as const,
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }

          return {
            results: [
              { index: 0, content: 'fallback', finishReason: 'stop' as const },
            ],
            modelUsage: makeModelUsage(),
          };
        },
      });

      const myAgent = agent('docText:string, query:string -> answer:string', {
        contextFields: ['docText'],
        functions: [simpleFn],
        runtime: makeRuntime(),
      });

      const result = await myAgent.forward(mockAI, {
        docText: 'The answer is 42.',
        query: 'What is the answer?',
      });

      expect(result.answer).toBe('42');
      expect(ctxActorCalls).toBe(1);
      expect(taskActorCalls).toBe(1);
      expect(finalResponderCalls).toBe(1);
    });

    it('ctx actor sees only context field in user input (not query)', async () => {
      const ctxActorPrompts: string[] = [];

      const mockAI = new AxMockAIService({
        features: { functions: false, streaming: false },
        chatResponse: async (req) => {
          const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

          if (systemPrompt.includes('You (`distiller`)')) {
            // Capture the full prompt to assert on field names
            for (const msg of req.chatPrompt) {
              if (msg.role === 'user') {
                ctxActorPrompts.push(String(msg.content ?? ''));
              }
            }
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: final("distilled")',
                  finishReason: 'stop' as const,
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }

          if (systemPrompt.includes('You (`executor`)')) {
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: final("done", {"answer":"ok"})',
                  finishReason: 'stop' as const,
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }

          return {
            results: [
              {
                index: 0,
                content: 'Answer: ok',
                finishReason: 'stop' as const,
              },
            ],
            modelUsage: makeModelUsage(),
          };
        },
      });

      const myAgent = agent('docText:string, query:string -> answer:string', {
        contextFields: ['docText'],
        functions: [simpleFn],
        runtime: makeRuntime(),
      });

      await myAgent.forward(mockAI, {
        docText: 'Long doc content here.',
        query: 'What is the main point?',
      });

      const allCtxPromptText = ctxActorPrompts.join('\n');
      expect(allCtxPromptText).toContain('docText');
      expect(allCtxPromptText).not.toContain('query');
    });

    it('task actor receives executorRequest + distilledContext in its user prompt', async () => {
      const taskActorPrompts: string[] = [];

      const mockAI = new AxMockAIService({
        features: { functions: false, streaming: false },
        chatResponse: async (req) => {
          const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

          if (systemPrompt.includes('You (`distiller`)')) {
            return {
              results: [
                {
                  index: 0,
                  content:
                    'Javascript Code: final("distilled", {"summary":"key facts"})',
                  finishReason: 'stop' as const,
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }

          if (systemPrompt.includes('You (`executor`)')) {
            // Capture task actor user prompts
            for (const msg of req.chatPrompt) {
              if (msg.role === 'user') {
                taskActorPrompts.push(String(msg.content ?? ''));
              }
            }
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: final("done", {"answer":"found"})',
                  finishReason: 'stop' as const,
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }

          if (systemPrompt.includes('Answer Synthesis Agent')) {
            return {
              results: [
                {
                  index: 0,
                  content: 'Answer: found',
                  finishReason: 'stop' as const,
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }

          return {
            results: [
              { index: 0, content: 'fallback', finishReason: 'stop' as const },
            ],
            modelUsage: makeModelUsage(),
          };
        },
      });

      const myAgent = agent('docText:string, query:string -> answer:string', {
        contextFields: ['docText'],
        functions: [simpleFn],
        runtime: makeRuntime(),
      });

      await myAgent.forward(mockAI, {
        docText: 'Source document.',
        query: 'Summarize.',
      });

      const allTaskPromptText = taskActorPrompts.join('\n');
      expect(allTaskPromptText).toContain('Executor Request');
      expect(allTaskPromptText).toContain('Distilled Context');
    });
  });

  // -------------------------------------------------------------------------
  // Staged context flow without tools still uses ctx → task
  // -------------------------------------------------------------------------

  describe('contextFields only, no tools (still staged)', () => {
    it('runs context explorer then task executor before the responder', async () => {
      let ctxActorCalled = false;
      let taskActorCalled = false;
      let taskSystemPrompt = '';

      const mockAI = new AxMockAIService({
        features: { functions: false, streaming: false },
        chatResponse: async (req) => {
          const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

          if (systemPrompt.includes('You (`distiller`)')) {
            ctxActorCalled = true;
            return {
              results: [
                {
                  index: 0,
                  content:
                    'Javascript Code: final("Summarize the document", {"summary":"key facts"})',
                  finishReason: 'stop' as const,
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }

          if (systemPrompt.includes('You (`executor`)')) {
            taskActorCalled = true;
            taskSystemPrompt = systemPrompt;
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: final("done", {})',
                  finishReason: 'stop' as const,
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }

          if (systemPrompt.includes('Answer Synthesis Agent')) {
            return {
              results: [
                {
                  index: 0,
                  content: 'Summary: extracted',
                  finishReason: 'stop' as const,
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }

          return {
            results: [
              { index: 0, content: 'fallback', finishReason: 'stop' as const },
            ],
            modelUsage: makeModelUsage(),
          };
        },
      });

      const myAgent = agent('docText:string -> summary:string', {
        contextFields: ['docText'],
        // No functions, agents, or functionDiscovery
        runtime: makeRuntime(),
      });

      const result = await myAgent.forward(mockAI, {
        docText: 'Some long document.',
      });

      expect(result.summary).toBe('extracted');
      expect(ctxActorCalled).toBe(true);
      expect(taskActorCalled).toBe(true);
      expect(taskSystemPrompt).toContain(
        'Executor Request & Distilled Context'
      );
    });

    it('contextFields + functionDiscovery only → still creates executor', () => {
      const myAgent = agent('docText:string -> summary:string', {
        contextFields: ['docText'],
        functionDiscovery: true,
        runtime: makeRuntime(),
      });
      expect(myAgent.distiller).toBeDefined();
      expect(myAgent.executor).toBeDefined();
      expect(myAgent.responder).toBeDefined();
    });

    it('contextFields + functions → executor present', () => {
      const myAgent = agent('docText:string -> summary:string', {
        contextFields: ['docText'],
        functions: [simpleFn],
        runtime: makeRuntime(),
      });
      expect(myAgent.distiller).toBeDefined();
      expect(myAgent.executor).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Case C: tools only, no contextFields → static three-stage pipeline
  // -------------------------------------------------------------------------

  describe('Case C: tools only, no contextFields (static pipeline)', () => {
    it('runs context explorer, task executor, and responder', async () => {
      let ctxActorCalled = false;
      let taskActorCalled = false;
      const mockAI = new AxMockAIService({
        features: { functions: false, streaming: false },
        chatResponse: async (req) => {
          const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

          if (systemPrompt.includes('You (`distiller`)')) {
            ctxActorCalled = true;
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: final("What is 6 * 7?", {})',
                  finishReason: 'stop' as const,
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }

          if (systemPrompt.includes('You (`executor`)')) {
            taskActorCalled = true;
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: final("done", {"answer":"ok"})',
                  finishReason: 'stop' as const,
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }

          if (systemPrompt.includes('Answer Synthesis Agent')) {
            return {
              results: [
                {
                  index: 0,
                  content: 'Answer: ok',
                  finishReason: 'stop' as const,
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }

          return {
            results: [
              { index: 0, content: 'fallback', finishReason: 'stop' as const },
            ],
            modelUsage: makeModelUsage(),
          };
        },
      });

      const myAgent = agent('query:string -> answer:string', {
        // No contextFields
        functions: [simpleFn],
        runtime: makeRuntime(),
      });

      const result = await myAgent.forward(mockAI, { query: 'What is 6 * 7?' });
      expect(result.answer).toBe('ok');
      expect(myAgent.distiller).toBeDefined();
      expect(ctxActorCalled).toBe(true);
      expect(taskActorCalled).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Case D: neither contextFields nor tools → static three-stage pipeline
  // -------------------------------------------------------------------------

  describe('Case D: no contextFields, no tools (static pipeline)', () => {
    it('runs context explorer, task executor, and responder', async () => {
      let ctxActorCalled = false;
      let taskActorCalled = false;
      const mockAI = new AxMockAIService({
        features: { functions: false, streaming: false },
        chatResponse: async (req) => {
          const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

          if (systemPrompt.includes('You (`distiller`)')) {
            ctxActorCalled = true;
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: final("Anything?", {})',
                  finishReason: 'stop' as const,
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }

          if (systemPrompt.includes('You (`executor`)')) {
            taskActorCalled = true;
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: final("done", {})',
                  finishReason: 'stop' as const,
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }

          if (systemPrompt.includes('Answer Synthesis Agent')) {
            return {
              results: [
                {
                  index: 0,
                  content: 'Answer: 42',
                  finishReason: 'stop' as const,
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }

          return {
            results: [
              { index: 0, content: 'fallback', finishReason: 'stop' as const },
            ],
            modelUsage: makeModelUsage(),
          };
        },
      });

      const myAgent = agent('query:string -> answer:string', {
        // No contextFields, no functions
        runtime: makeRuntime(),
      });

      const result = await myAgent.forward(mockAI, { query: 'Anything?' });
      expect(result.answer).toBe('42');
      expect(myAgent.distiller).toBeDefined();
      expect(ctxActorCalled).toBe(true);
      expect(taskActorCalled).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // getFunction()
  // -------------------------------------------------------------------------

  describe('getFunction()', () => {
    it('returns a valid function descriptor when agentIdentity is set', async () => {
      const mockAI = new AxMockAIService({
        features: { functions: false, streaming: false },
        chatResponse: async (req) => {
          const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

          if (systemPrompt.includes('You (`distiller`)')) {
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: final("test", {})',
                  finishReason: 'stop' as const,
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }

          if (systemPrompt.includes('You (`executor`)')) {
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: final("done", {"answer":"ok"})',
                  finishReason: 'stop' as const,
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }

          return {
            results: [
              {
                index: 0,
                content: 'Answer: ok',
                finishReason: 'stop' as const,
              },
            ],
            modelUsage: makeModelUsage(),
          };
        },
      });

      const myAgent = new AxAgent(
        {
          signature: 'query:string -> answer:string',
          agentIdentity: { name: 'My Helper', description: 'helps' },
        },
        {
          contextFields: [],
          runtime: makeRuntime(),
        }
      );

      const fn = myAgent.getFunction();
      expect(fn).toHaveProperty('name');
      expect(fn).toHaveProperty('description');
      expect(fn).toHaveProperty('parameters');
      expect(fn).toHaveProperty('func');
      expect(typeof fn.func).toBe('function');

      // Calling func should resolve without throwing
      await expect(
        fn.func({ query: 'test' }, { ai: mockAI })
      ).resolves.toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // applyOptimization
  // -------------------------------------------------------------------------

  describe('applyOptimization()', () => {
    it('does not throw when called on a Case A agent (smoke test)', () => {
      const myAgent = agent('docText:string, query:string -> answer:string', {
        contextFields: ['docText'],
        functions: [simpleFn],
        runtime: makeRuntime(),
      });

      expect(() => myAgent.applyOptimization({})).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Case A: clarification from ctx stage surfaces AxAgentClarificationError
  // -------------------------------------------------------------------------

  describe('clarification from ctx stage', () => {
    it('rejects with AxAgentClarificationError when ctx actor calls askClarification', async () => {
      const mockAI = new AxMockAIService({
        features: { functions: false, streaming: false },
        chatResponse: async (req) => {
          const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

          if (systemPrompt.includes('You (`distiller`)')) {
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: askClarification("what format?")',
                  finishReason: 'stop' as const,
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }

          // Responder / task actor fall-through — should not be reached
          return {
            results: [
              {
                index: 0,
                content: 'Answer: never',
                finishReason: 'stop' as const,
              },
            ],
            modelUsage: makeModelUsage(),
          };
        },
      });

      const myAgent = agent('docText:string, query:string -> answer:string', {
        contextFields: ['docText'],
        functions: [simpleFn],
        runtime: makeRuntime(),
      });

      await expect(
        myAgent.forward(mockAI, {
          docText: 'Some text.',
          query: 'A question.',
        })
      ).rejects.toBeInstanceOf(AxAgentClarificationError);
    });
  });

  // -------------------------------------------------------------------------
  // Case A: explorer's `final(request, evidence)` payload becomes the executor's
  // `executorRequest` / `distilledContext` directly — there is no separate
  // distillation LLM call.
  // -------------------------------------------------------------------------

  describe('Case A: explorer payload feeds executor directly', () => {
    it("forwards explorer's request/evidence as executor executorRequest/distilledContext", async () => {
      const taskActorPrompts: string[] = [];

      const mockAI = new AxMockAIService({
        features: { functions: false, streaming: false },
        chatResponse: async (req) => {
          const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

          if (systemPrompt.includes('You (`distiller`)')) {
            return {
              results: [
                {
                  index: 0,
                  content:
                    'Javascript Code: final("Deliver the answer", {"evidence":"the answer is 42"})',
                  finishReason: 'stop' as const,
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }

          if (systemPrompt.includes('You (`executor`)')) {
            for (const msg of req.chatPrompt) {
              if (msg.role === 'user') {
                taskActorPrompts.push(String(msg.content ?? ''));
              }
            }
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: final("done", {"answer":"42"})',
                  finishReason: 'stop' as const,
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }

          if (systemPrompt.includes('Answer Synthesis Agent')) {
            return {
              results: [
                {
                  index: 0,
                  content: 'Answer: 42',
                  finishReason: 'stop' as const,
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }

          return {
            results: [
              { index: 0, content: 'fallback', finishReason: 'stop' as const },
            ],
            modelUsage: makeModelUsage(),
          };
        },
      });

      const myAgent = agent('docText:string, query:string -> answer:string', {
        contextFields: ['docText'],
        functions: [simpleFn],
        runtime: makeRuntime(),
      });

      const result = await myAgent.forward(mockAI, {
        docText: 'The answer is 42.',
        query: 'What is the answer?',
      });

      expect(result.answer).toBe('42');
      const taskPromptText = taskActorPrompts.join('\n');
      // The distiller's first arg becomes `executorRequest` in the executor's
      // prompt. The evidence value itself is runtime-resident: the prompt
      // carries only its shape summary, never the materialized data.
      expect(taskPromptText).toContain('Deliver the answer');
      expect(taskPromptText).toContain('Distilled Context Summary');
      expect(taskPromptText).toContain('inputs.distilledContext');
      expect(taskPromptText).not.toContain('the answer is 42');
    });

    it('does not advertise finalForUser anywhere in the ctx actor prompt', async () => {
      let ctxSystemPrompt = '';

      const mockAI = new AxMockAIService({
        features: { functions: false, streaming: false },
        chatResponse: async (req) => {
          const systemPrompt = String(req.chatPrompt[0]?.content ?? '');
          if (systemPrompt.includes('You (`distiller`)')) {
            ctxSystemPrompt = systemPrompt;
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: final("distilled", {})',
                  finishReason: 'stop' as const,
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }
          if (systemPrompt.includes('You (`executor`)')) {
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: final("done", {"answer":"ok"})',
                  finishReason: 'stop' as const,
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }
          return {
            results: [
              {
                index: 0,
                content: 'Answer: ok',
                finishReason: 'stop' as const,
              },
            ],
            modelUsage: makeModelUsage(),
          };
        },
      });

      const myAgent = agent('docText:string, query:string -> answer:string', {
        contextFields: ['docText'],
        functions: [simpleFn],
        runtime: makeRuntime(),
      });

      await myAgent.forward(mockAI, {
        docText: 'x',
        query: 'y',
      });

      expect(ctxSystemPrompt).not.toContain('finalForUser');
    });
  });

  // -------------------------------------------------------------------------
  // Stage D: strict knob routing — the distiller shares the capability
  // *surface* (function metadata, discovery, skills) for reconnaissance, but
  // execution authority stays with the executor (distiller callables are
  // throwing stubs and child agents are not double-registered).
  // -------------------------------------------------------------------------

  describe('strict knob routing (Stage D)', () => {
    it('functions/functionDiscovery reach the distiller as reconnaissance surface only', () => {
      const childAgent = agent('inputText:string -> outputText:string', {
        agentIdentity: { name: 'childAgent', description: 'child' },
        runtime: makeRuntime(),
      });

      const a = agent('docText:string, query:string -> answer:string', {
        contextFields: ['docText'],
        functions: [simpleFn, childAgent],
        functionDiscovery: true,

        runtime: makeRuntime(),
      });
      const coord = a as any;

      // distiller sees the capability surface (catalogs, discovery)…
      expect(coord.distiller).toBeDefined();
      expect(coord.distiller.agentFunctions.length).toBeGreaterThan(1);
      expect(coord.distiller.functionDiscoveryEnabled).toBe(true);
      // …but never owns child agents (no duplicate optimizer registration).
      expect(coord.distiller.agents ?? []).toEqual([]);

      // executor must see everything (functions + child agents both inlined)
      expect(coord.executor.agentFunctions.length).toBeGreaterThan(1);
      expect(coord.executor.agents?.length ?? 0).toBeGreaterThan(0);
      expect(coord.executor.functionDiscoveryEnabled).toBe(true);
    });

    it('top-level maxTurns applies to taskAgent; contextOptions.maxTurns overrides on ctxAgent', () => {
      const a = agent('docText:string, query:string -> answer:string', {
        contextFields: ['docText'],
        functions: [simpleFn],
        maxTurns: 10,
        contextOptions: { maxTurns: 3 },
        runtime: makeRuntime(),
      });
      const coord = a as any;

      expect(coord.distiller._genOptions.maxTurns).toBe(3);
      expect(coord.executor._genOptions.maxTurns).toBe(10);
    });

    it('top-level maxTurns is shared to ctxAgent when no contextOptions override is set', () => {
      const a = agent('docText:string, query:string -> answer:string', {
        contextFields: ['docText'],
        functions: [simpleFn],
        maxTurns: 7,
        runtime: makeRuntime(),
      });
      const coord = a as any;

      expect(coord.distiller._genOptions.maxTurns).toBe(7);
      expect(coord.executor._genOptions.maxTurns).toBe(7);
    });
  });

  // -------------------------------------------------------------------------
  // Per-stage `ai` overrides on contextOptions / executorOptions / responderOptions
  // -------------------------------------------------------------------------

  describe('per-stage ai override', () => {
    type StageMockOptions = {
      tag: string;
      counter: { count: number };
    };

    const makeTrackingAI = ({ tag, counter }: StageMockOptions) =>
      new AxMockAIService({
        name: tag,
        features: { functions: false, streaming: false },
        chatResponse: async (req) => {
          counter.count++;
          const systemPrompt = String(req.chatPrompt[0]?.content ?? '');
          if (systemPrompt.includes('You (`distiller`)')) {
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: final("normalized", {})',
                  finishReason: 'stop' as const,
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }
          if (systemPrompt.includes('You (`executor`)')) {
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: final("done", {})',
                  finishReason: 'stop' as const,
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }
          if (systemPrompt.includes('Answer Synthesis Agent')) {
            return {
              results: [
                {
                  index: 0,
                  content: 'Answer: ok',
                  finishReason: 'stop' as const,
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }
          return {
            results: [
              { index: 0, content: 'fallback', finishReason: 'stop' as const },
            ],
            modelUsage: makeModelUsage(),
          };
        },
      });

    it('contextOptions.ai routes the distiller call to the override AI', async () => {
      const baseCounter = { count: 0 };
      const overrideCounter = { count: 0 };
      const baseAI = makeTrackingAI({ tag: 'base', counter: baseCounter });
      const overrideAI = makeTrackingAI({
        tag: 'override',
        counter: overrideCounter,
      });

      const myAgent = agent('query:string -> answer:string', {
        runtime: makeRuntime(),
        contextOptions: { ai: overrideAI },
      });

      const result = await myAgent.forward(baseAI, { query: 'hi' });
      expect(result.answer).toBe('ok');
      // Override handles the distiller (1 call); base handles executor + responder (2 calls)
      expect(overrideCounter.count).toBe(1);
      expect(baseCounter.count).toBe(2);
    });

    it('executorOptions.ai routes the executor call to the override AI', async () => {
      const baseCounter = { count: 0 };
      const overrideCounter = { count: 0 };
      const baseAI = makeTrackingAI({ tag: 'base', counter: baseCounter });
      const overrideAI = makeTrackingAI({
        tag: 'override',
        counter: overrideCounter,
      });

      const myAgent = agent('query:string -> answer:string', {
        runtime: makeRuntime(),
        executorOptions: { ai: overrideAI },
      });

      await myAgent.forward(baseAI, { query: 'hi' });
      expect(overrideCounter.count).toBe(1);
      expect(baseCounter.count).toBe(2);
    });

    it('responderOptions.ai routes the responder call to the override AI', async () => {
      const baseCounter = { count: 0 };
      const overrideCounter = { count: 0 };
      const baseAI = makeTrackingAI({ tag: 'base', counter: baseCounter });
      const overrideAI = makeTrackingAI({
        tag: 'override',
        counter: overrideCounter,
      });

      const myAgent = agent('query:string -> answer:string', {
        runtime: makeRuntime(),
        responderOptions: { ai: overrideAI },
      });

      await myAgent.forward(baseAI, { query: 'hi' });
      expect(overrideCounter.count).toBe(1);
      expect(baseCounter.count).toBe(2);
    });

    it('falls back to forward(ai) when no stage override is set', async () => {
      const baseCounter = { count: 0 };
      const baseAI = makeTrackingAI({ tag: 'base', counter: baseCounter });

      const myAgent = agent('query:string -> answer:string', {
        runtime: makeRuntime(),
      });

      await myAgent.forward(baseAI, { query: 'hi' });
      expect(baseCounter.count).toBe(3);
    });

    it('streamingForward also routes per-stage ai overrides', async () => {
      const baseCounter = { count: 0 };
      const overrideCounter = { count: 0 };
      const baseAI = makeTrackingAI({ tag: 'base', counter: baseCounter });
      const overrideAI = makeTrackingAI({
        tag: 'override',
        counter: overrideCounter,
      });

      const myAgent = agent('query:string -> answer:string', {
        runtime: makeRuntime(),
        responderOptions: { ai: overrideAI },
      });

      // Drain the stream
      const stream = myAgent.streamingForward(baseAI, { query: 'hi' });
      for await (const _ of stream) {
        // consume
      }
      expect(overrideCounter.count).toBe(1);
      expect(baseCounter.count).toBe(2);
    });

    it('exposes stage override AIs as public fields on the coordinator', () => {
      const overrideA = new AxMockAIService({ name: 'A' });
      const overrideB = new AxMockAIService({ name: 'B' });
      const overrideC = new AxMockAIService({ name: 'C' });

      const myAgent = agent('query:string -> answer:string', {
        runtime: makeRuntime(),
        contextOptions: { ai: overrideA },
        executorOptions: { ai: overrideB },
        responderOptions: { ai: overrideC },
      });

      expect(myAgent.distillerAi).toBe(overrideA);
      expect(myAgent.executorAi).toBe(overrideB);
      expect(myAgent.responderAi).toBe(overrideC);
    });
  });
});
