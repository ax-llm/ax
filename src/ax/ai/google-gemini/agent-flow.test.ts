import { describe, expect, it } from 'vitest';

import { AxMockAIService } from '../mock/api.js';
import { agent, s } from '../../index.js';
import type { AxCodeRuntime } from '../../prompts/rlm.js';

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

        if (systemPrompt.includes('Code Generation Agent')) {
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
                  content: 'Javascript Code: final("done")',
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
      language: 'JavaScript',
      createSession(globals) {
        return {
          execute: async (code: string) => {
            if (globals?.final && code.includes('final(')) {
              if (code.includes('"Clear skies, 72F"')) {
                (globals.final as (...args: unknown[]) => void)(
                  'Clear skies, 72F'
                );
              } else {
                (globals.final as (...args: unknown[]) => void)('done');
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
          close: () => {},
        };
      },
    };

    const sig = s('customerQuery:string -> plan:string, restaurant:string');

    const gen = agent(sig, {
      contextFields: [],
      runtime,
      maxTurns: 3,
      mode: 'advanced',
    });

    const res = await gen.forward(mockAI, {
      customerQuery: 'Lunch in SF, sushi, nice weather',
    });

    expect(res.plan).toBeDefined();
    expect(res.restaurant).toBe('Sukiyabashi Jiro');
    expect(actorCallCount).toBe(2);
  });
});
