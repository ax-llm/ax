import { describe, expect, it } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import type { AxChatResponse } from '../ai/types.js';

import { agent } from './index.js';
import type { AxCodeRuntime } from './rlm.js';

const makeModelUsage = () => ({
  ai: 'mock',
  model: 'mock',
  tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
});

// ── Runtime helpers ─────────────────────────────────────────────────────────

/**
 * A runtime whose `execute()` parses `final("msg", {...})` calls and
 * invokes the `globals.final` callback so the actor loop completes.
 */
const makeFinalRuntime = (): AxCodeRuntime => ({
  getUsageInstructions: () => '',
  createSession(globals) {
    return {
      execute: async (code: string) => {
        if (globals?.final && code.includes('final(')) {
          // Extract arguments: final("msg") or final("msg", {...})
          const twoArgMatch = code.match(
            /final\(\s*"([^"]*)"\s*,\s*(\{[\s\S]*?\})\s*\)/
          );
          if (twoArgMatch) {
            let parsed: Record<string, unknown> = {};
            try {
              parsed = JSON.parse(twoArgMatch[2]!);
            } catch {
              // ignore parse errors; pass empty object
            }
            (globals.final as (...args: unknown[]) => void)(
              twoArgMatch[1],
              parsed
            );
            return 'submitted';
          }
          const oneArgMatch = code.match(/final\(\s*"([^"]*)"\s*\)/);
          if (oneArgMatch) {
            (globals.final as (...args: unknown[]) => void)(oneArgMatch[1]);
            return 'submitted';
          }
        }
        return `executed: ${code}`;
      },
      patchGlobals: async () => {},
      close: () => {},
    };
  },
});

// ── Mock AI builders ─────────────────────────────────────────────────────────

/**
 * Mock AI for Case A (contextFields + function):
 *   - "Context Understanding Agent" (ctx actor) → final("distilled", {evidence:"info"})
 *   - "Code Generation Agent"       (task actor) → final("done", {answer:"ok"})
 *   - responder:
 *       ctx responder system prompt mentions "Distilled Context" output field
 *         → Distilled Context: {"evidence":"info"}
 *       task responder system prompt mentions "Answer" output field
 *         → Answer: ok
 */
const makeCaseAMockAI = () =>
  new AxMockAIService({
    features: { functions: false, streaming: false },
    chatResponse: async (req): Promise<AxChatResponse> => {
      const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

      if (systemPrompt.includes('Context Understanding Agent')) {
        return {
          results: [
            {
              index: 0,
              content:
                'Javascript Code: final("distilled", {"evidence":"info"})',
              finishReason: 'stop' as const,
            },
          ],
          modelUsage: makeModelUsage(),
        };
      }

      if (systemPrompt.includes('Code Generation Agent')) {
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

      // FinalResponder
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

/**
 * Mock AI for Case C (no contextFields, has function):
 *   - "Code Generation Agent" (task actor) → final("done", {answer:"ok"})
 *   - Responder                            → Answer: ok
 */
const makeCaseCMockAI = () =>
  new AxMockAIService({
    features: { functions: false, streaming: false },
    chatResponse: async (req): Promise<AxChatResponse> => {
      const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

      if (systemPrompt.includes('Code Generation Agent')) {
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

      // Responder
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

// ── Agent factories ──────────────────────────────────────────────────────────

const stubFunction = {
  name: 'stubFn',
  description: 'A stub function for testing',
  parameters: {
    type: 'object' as const,
    properties: {
      input: { type: 'string' as const },
    },
    required: [],
  },
  func: async () => 'stub result',
};

const makeCaseAAgent = () =>
  agent('docText:string, query:string -> answer:string', {
    contextFields: ['docText'],
    functions: [stubFunction],
    runtime: makeFinalRuntime(),
    maxTurns: 3,
  });

const makeCaseCAgent = () =>
  agent('query:string -> answer:string', {
    contextFields: [],
    functions: [stubFunction],
    runtime: makeFinalRuntime(),
    maxTurns: 3,
  });

// ── Tests ────────────────────────────────────────────────────────────────────

describe('getChatLog() stage markers', () => {
  it('tags actor entries with stage markers in Case A (ctx+task two-stage)', async () => {
    const mockAI = makeCaseAMockAI();
    const ag = makeCaseAAgent();

    await ag.forward(mockAI, { docText: 'some document text', query: 'what?' });

    const log = ag.getChatLog();

    // In Case A the coordinator tags every entry with 'ctx' or 'task'
    const actorEntries = log.actor;
    expect(actorEntries.length).toBeGreaterThan(0);

    const ctxEntries = actorEntries.filter((e: any) => e.stage === 'ctx');
    const taskEntries = actorEntries.filter((e: any) => e.stage === 'task');

    expect(ctxEntries.length).toBeGreaterThan(0);
    expect(taskEntries.length).toBeGreaterThan(0);
  });

  it('returns no stage markers on actor entries in Case C (single-stage, no contextFields)', async () => {
    const mockAI = makeCaseCMockAI();
    const ag = makeCaseCAgent();

    await ag.forward(mockAI, { query: 'what?' });

    const log = ag.getChatLog();
    const actorEntries = log.actor;

    expect(actorEntries.length).toBeGreaterThan(0);

    // Case C is a single-stage flow; no coordinator tagging happens
    for (const entry of actorEntries) {
      expect((entry as any).stage).toBeUndefined();
    }
  });
});

describe('getStagedUsage()', () => {
  it('returns per-stage breakdown with ctx and task for Case A', async () => {
    const mockAI = makeCaseAMockAI();
    const ag = makeCaseAAgent();

    await ag.forward(mockAI, { docText: 'some document text', query: 'what?' });

    const staged = (ag as any).getStagedUsage() as {
      ctx?: { actor: unknown[]; responder: unknown[] };
      task: { actor: unknown[]; responder: unknown[] };
    };

    expect(staged).toHaveProperty('ctx');
    expect(staged).toHaveProperty('task');

    expect(staged.ctx).toBeDefined();
    expect(Array.isArray(staged.ctx!.actor)).toBe(true);
    expect(Array.isArray(staged.ctx!.responder)).toBe(true);
    expect(Array.isArray(staged.task.actor)).toBe(true);
    expect(Array.isArray(staged.task.responder)).toBe(true);
  });

  it('returns only task (no ctx) for Case C (single-stage, no contextFields)', async () => {
    const mockAI = makeCaseCMockAI();
    const ag = makeCaseCAgent();

    await ag.forward(mockAI, { query: 'what?' });

    const staged = (ag as any).getStagedUsage() as {
      ctx?: { actor: unknown[]; responder: unknown[] };
      task: { actor: unknown[]; responder: unknown[] };
    };

    expect(staged.ctx).toBeUndefined();
    expect(staged).toHaveProperty('task');
    expect(Array.isArray(staged.task.actor)).toBe(true);
    expect(Array.isArray(staged.task.responder)).toBe(true);
  });
});
