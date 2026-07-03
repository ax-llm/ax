/**
 * Benchmark: ctx-vs-task prompt shrink ratio
 *
 * Verifies that contextFields actually reduce the downstream task-actor prompt
 * versus the same signature with no configured context fields.
 *
 * Asserts:
 *   1. Task-actor in Case A omits "Exploration & Truncation" and uses the
 *      shorter "Pre-Distilled Context" hint instead.
 *   2. Task-actor system prompt in Case A excludes raw context values that a
 *      no-contextFields agent keeps in the task side.
 */
import { describe, expect, it } from 'vitest';
import { AxMockAIService } from '../../ai/mock/api.js';
import type { AxAIService } from '../../ai/types.js';
import type { AxAgentFunction } from '../index.js';
import { agent } from '../index.js';
import type { AxCodeRuntime } from '../rlm.js';

const makeModelUsage = () => ({
  ai: 'mock',
  model: 'mock',
  tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
});

const getSystemPrompt = (
  chatPrompt: { role: string; content?: unknown }[]
): string => {
  const first = chatPrompt[0] as
    | { role: string; content?: unknown }
    | undefined;
  return typeof first?.content === 'string' ? first.content : '';
};

const makeRuntime = (): AxCodeRuntime => ({
  getUsageInstructions: () => '',
  createSession(globals) {
    return {
      execute: async (code: string) => {
        if (globals?.final && code.includes('final(')) {
          const match = code.match(/final\("([^"]*)"(?:,\s*(\{[^}]*\}))?\)/);
          if (match) {
            const extra = match[2] ? JSON.parse(match[2]) : {};
            (globals.final as (...args: unknown[]) => void)(match[1], extra);
          }
          return 'submitted';
        }
        return 'executed';
      },
      patchGlobals: async () => {},
      close: () => {},
    };
  },
});

const stubFn: AxAgentFunction = {
  name: 'lookup',
  description: 'Look something up',
  parameters: {
    type: 'object',
    properties: { q: { type: 'string', description: 'query' } },
    required: ['q'],
  },
  func: async () => 'result',
};

describe('ctx-vs-task prompt shrink ratio', () => {
  it('task-actor in Case A omits Exploration & Turn Discipline paragraph', async () => {
    let taskActorSystemPrompt = '';
    let ctxActorSystemPrompt = '';
    let _responderCallCount = 0;

    const mockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = getSystemPrompt(
          req.chatPrompt as { role: string; content?: unknown }[]
        );

        if (systemPrompt.includes('You (`distiller`)')) {
          ctxActorSystemPrompt = systemPrompt;
          return {
            results: [
              {
                index: 0,
                content:
                  'Javascript Code: final("distilled", {"evidence":"summary"})',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }
        if (systemPrompt.includes('You (`executor`)')) {
          taskActorSystemPrompt = systemPrompt;
          return {
            results: [
              {
                index: 0,
                content: 'Javascript Code: final("done", {"answer":"42"})',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }
        _responderCallCount++;
        return {
          results: [{ index: 0, content: 'Answer: 42', finishReason: 'stop' }],
          modelUsage: makeModelUsage(),
        };
      },
    });

    const caseAAgent = agent('docText:string, query:string -> answer:string', {
      contextFields: ['docText'],
      functions: [stubFn],
      runtime: makeRuntime(),
      maxTurns: 2,
    });

    await caseAAgent.forward(mockAI as unknown as AxAIService, {
      docText: 'long document',
      query: 'what?',
    });

    // ctx actor probes raw context fields directly
    expect(ctxActorSystemPrompt).toContain('### Context Fields');
    expect(ctxActorSystemPrompt).not.toContain(
      'Executor Request & Distilled Context'
    );
    // task actor skips exploration — it has pre-distilled context from ctx stage
    expect(taskActorSystemPrompt).not.toContain('### Context Fields');
    expect(taskActorSystemPrompt).toContain(
      'Executor Request & Distilled Context'
    );
  });

  it('task-actor in Case A does not include raw context field docText in its prompt', async () => {
    let caseACtxActorUserPrompt = '';
    let caseATaskActorSystemPrompt = '';
    let caseATaskActorUserPrompt = '';
    let caseCTaskActorSystemPrompt = '';
    let _responderCallCount = 0;

    const mockAICaseA = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = getSystemPrompt(
          req.chatPrompt as { role: string; content?: unknown }[]
        );
        const userPrompt = String(req.chatPrompt[1]?.content ?? '');

        if (systemPrompt.includes('You (`distiller`)')) {
          caseACtxActorUserPrompt = userPrompt;
          return {
            results: [
              {
                index: 0,
                content:
                  'Javascript Code: final("distilled", {"evidence":"summary"})',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }
        if (systemPrompt.includes('You (`executor`)')) {
          caseATaskActorSystemPrompt = systemPrompt;
          caseATaskActorUserPrompt = userPrompt;
          return {
            results: [
              {
                index: 0,
                content: 'Javascript Code: final("done", {"answer":"42"})',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }
        _responderCallCount++;
        return {
          results: [{ index: 0, content: 'Answer: 42', finishReason: 'stop' }],
          modelUsage: makeModelUsage(),
        };
      },
    });

    const caseAAgent = agent('docText:string, query:string -> answer:string', {
      contextFields: ['docText'],
      functions: [stubFn],
      runtime: makeRuntime(),
      maxTurns: 2,
    });

    await caseAAgent.forward(mockAICaseA as unknown as AxAIService, {
      docText: 'long document',
      query: 'what?',
    });

    let caseCResponderCalled = false;
    const mockAICaseC = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = getSystemPrompt(
          req.chatPrompt as { role: string; content?: unknown }[]
        );

        if (systemPrompt.includes('You (`distiller`)')) {
          return {
            results: [
              {
                index: 0,
                content:
                  'Javascript Code: final("what?", {"docText":"long document"})',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }
        if (systemPrompt.includes('You (`executor`)')) {
          caseCTaskActorSystemPrompt = systemPrompt;
          return {
            results: [
              {
                index: 0,
                content: 'Javascript Code: final("done", {"answer":"ok"})',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }
        caseCResponderCalled = true;
        return {
          results: [{ index: 0, content: 'Answer: ok', finishReason: 'stop' }],
          modelUsage: makeModelUsage(),
        };
      },
    });

    // Same tools and signature, but no configured contextFields.
    const caseCAgent = agent('docText:string, query:string -> answer:string', {
      functions: [stubFn],
      runtime: makeRuntime(),
      maxTurns: 2,
    });

    await caseCAgent.forward(mockAICaseC as unknown as AxAIService, {
      docText: 'long document',
      query: 'what?',
    });

    expect(caseCResponderCalled).toBe(true);
    expect(caseACtxActorUserPrompt).toContain('Query: what?');
    expect(caseACtxActorUserPrompt).toContain('Context Metadata:');
    expect(caseACtxActorUserPrompt).toContain('docText');
    expect(caseATaskActorSystemPrompt).toBeTruthy();
    expect(caseATaskActorUserPrompt).toContain('Executor Request: distilled');
    expect(caseATaskActorUserPrompt).toContain('Distilled Context Summary:');
    expect(caseATaskActorUserPrompt).not.toContain('Context Metadata:');
    expect(caseCTaskActorSystemPrompt).toBeTruthy();

    // The key distillation benefit: with declared contextFields, `docText` is
    // isolated to the context actor. Without contextFields, it remains a normal
    // task-side input.
    expect(caseATaskActorSystemPrompt).not.toContain('Doc Text');
    expect(caseATaskActorUserPrompt).not.toContain('Doc Text');
    expect(caseATaskActorSystemPrompt).not.toContain('long document');
    expect(caseATaskActorUserPrompt).not.toContain('long document');
    expect(caseCTaskActorSystemPrompt).toContain('Doc Text');
  });
});
