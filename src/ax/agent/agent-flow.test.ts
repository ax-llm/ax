import { describe, expect, it } from 'vitest';
import { AxMockAIService } from '../ai/mock/api.js';
import { agent, s } from '../index.js';
import {
  AX_HOST_SNIPPET_MARKER,
  AX_INPUTS_PATCH_GLOBAL,
} from './agentInternal/sharedSession.js';
import type { AxCodeRuntime } from './rlm.js';

const makeModelUsage = () => ({
  ai: 'mock',
  model: 'mock',
  tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
});

describe('Agent Split Architecture Flow', () => {
  it('should run Actor/Responder loop correctly in a multi-turn flow', async () => {
    let actorCallCount = 0;

    const mockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');
        const userPrompt = String(req.chatPrompt[1]?.content ?? '');

        if (systemPrompt.includes('You (`executor`)')) {
          if (userPrompt.includes('Lunch in SF')) {
            actorCallCount++;
            if (actorCallCount === 1) {
              return {
                results: [
                  {
                    index: 0,
                    content:
                      'Javascript Code: var weather = await llmQuery("What is the weather in SF?"); weather',
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
                  content:
                    'Javascript Code: final("generate output", { data: "done" })',
                  finishReason: 'stop' as const,
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }

          // Recursive sub-agent Actor call.
          return {
            results: [
              {
                index: 0,
                content: 'Javascript Code: final("Clear skies, 72F")',
                finishReason: 'stop' as const,
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }

        if (systemPrompt.includes('Answer Synthesis Agent')) {
          if (userPrompt.includes('What is the weather in SF?')) {
            return {
              results: [
                {
                  index: 0,
                  content: 'Answer: Clear skies, 72F',
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
                content:
                  'Plan: I found weather info for SF.\nRestaurant: Sukiyabashi Jiro',
                finishReason: 'stop' as const,
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }

        return {
          results: [{ index: 0, content: 'fallback', finishReason: 'stop' }],
          modelUsage: makeModelUsage(),
        };
      },
    });

    const runtime: AxCodeRuntime = {
      getUsageInstructions: () => '',
      language: 'JavaScript',
      createSession(globals) {
        return {
          execute: async (code: string) => {
            if (code.startsWith(AX_HOST_SNIPPET_MARKER)) return 'host-snippet';
            if (globals?.final && code.includes('final(')) {
              if (code.includes('"Clear skies, 72F"')) {
                (globals.final as (...args: unknown[]) => void)(
                  'Clear skies, 72F'
                );
              } else {
                (globals.final as (...args: unknown[]) => void)(
                  'generate output',
                  { data: 'done' }
                );
              }
              return 'submitted';
            }
            if (globals?.llmQuery && code.includes('llmQuery')) {
              const llmQueryFn = globals.llmQuery as (
                q: string
              ) => Promise<string>;
              return await llmQueryFn('What is the weather in SF?');
            }
            return `executed: ${code}`;
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
    };

    const sig = s('customerQuery:string -> plan:string, restaurant:string');

    const gen = agent(sig, {
      contextFields: [],
      runtime,
      maxTurns: 3,
    });

    const res = await gen.forward(mockAI, {
      customerQuery: 'Lunch in SF, sushi, nice weather',
    });

    expect(res.plan).toBeDefined();
    expect(res.restaurant).toBe('Sukiyabashi Jiro');
    expect(actorCallCount).toBe(2);
  });

  it('Case A: ctx+task two-stage flow with contextFields + function', async () => {
    let ctxActorCalls = 0;
    let taskActorCalls = 0;

    const stubFunction = {
      name: 'stubFn',
      description: 'A stub function for testing',
      parameters: {
        type: 'object' as const,
        properties: { input: { type: 'string' as const } },
        required: [] as string[],
      },
      func: async () => 'stub result',
    };

    const mockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

        if (systemPrompt.includes('You (`distiller`)')) {
          ctxActorCalls++;
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
          taskActorCalls++;
          return {
            results: [
              {
                index: 0,
                content: 'Javascript Code: final("done", {"answer":"done"})',
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
              content: 'Answer: done',
              finishReason: 'stop' as const,
            },
          ],
          modelUsage: makeModelUsage(),
        };
      },
    });

    const runtime: AxCodeRuntime = {
      getUsageInstructions: () => '',
      createSession(globals) {
        return {
          execute: async (code: string) => {
            if (code.startsWith(AX_HOST_SNIPPET_MARKER)) return 'host-snippet';
            if (globals?.final && code.includes('final(')) {
              const twoArgMatch = code.match(
                /final\(\s*"([^"]*)"\s*,\s*(\{[\s\S]*?\})\s*\)/
              );
              if (twoArgMatch) {
                let parsed: Record<string, unknown> = {};
                try {
                  parsed = JSON.parse(twoArgMatch[2]!);
                } catch {
                  /* ignore */
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
    };

    const gen = agent('docText:string, query:string -> answer:string', {
      contextFields: ['docText'],
      functions: [stubFunction],
      runtime,
      maxTurns: 3,
    });

    const res = await gen.forward(mockAI, {
      docText: 'some document content',
      query: 'what is this?',
    });

    expect(res.answer).toBe('done');
    // Both ctx actor and task actor must have been called
    expect(ctxActorCalls).toBeGreaterThan(0);
    expect(taskActorCalls).toBeGreaterThan(0);
  });

  it('contextFields without tools still run ctx then task', async () => {
    const mockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

        if (
          systemPrompt.includes('You (`executor`)') ||
          systemPrompt.includes('You (`distiller`)')
        ) {
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

        // Responder
        return {
          results: [
            {
              index: 0,
              content: 'Answer: extracted',
              finishReason: 'stop' as const,
            },
          ],
          modelUsage: makeModelUsage(),
        };
      },
    });

    const runtime: AxCodeRuntime = {
      getUsageInstructions: () => '',
      createSession(globals) {
        return {
          execute: async (code: string) => {
            if (code.startsWith(AX_HOST_SNIPPET_MARKER)) return 'host-snippet';
            if (globals?.final && code.includes('final(')) {
              const twoArgMatch = code.match(
                /final\(\s*"([^"]*)"\s*,\s*(\{[\s\S]*?\})\s*\)/
              );
              if (twoArgMatch) {
                (globals.final as (...args: unknown[]) => void)(
                  twoArgMatch[1],
                  {}
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
    };

    const gen = agent('docText:string -> answer:string', {
      contextFields: ['docText'],
      runtime,
      maxTurns: 3,
    });

    const res = await gen.forward(mockAI, {
      docText: 'some document content',
    });

    expect(res.answer).toBe('extracted');
  });
});
