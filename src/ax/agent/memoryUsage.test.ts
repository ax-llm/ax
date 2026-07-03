import { describe, expect, it, vi } from 'vitest';
import { AxMockAIService } from '../ai/mock/api.js';
import type { AxChatResponse } from '../ai/types.js';
import {
  AX_HOST_SNIPPET_MARKER,
  AX_INPUTS_PATCH_GLOBAL,
} from './agentInternal/sharedSession.js';
import { agent } from './index.js';
import type { AxCodeRuntime } from './rlm.js';

const makeModelUsage = () => ({
  ai: 'mock',
  model: 'mock',
  tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
});

const memoryRuntime: AxCodeRuntime = {
  getUsageInstructions: () => '',
  createSession(globals) {
    return {
      execute: async (code: string) => {
        if (code.startsWith(AX_HOST_SNIPPET_MARKER)) return 'host-snippet';
        if (code.includes('recall(')) {
          await (globals?.recall as (queries: string[]) => Promise<void>)([
            'coffee',
          ]);
          return 'loaded coffee memory';
        }
        if (code.includes('Used to resolve the user preference')) {
          await (
            globals?.used as (id: unknown, reason?: unknown) => Promise<void>
          )('coffee', 'Used to resolve the user preference');
          await (
            globals?.used as (id: unknown, reason?: unknown) => Promise<void>
          )('missing', 'Should be ignored');
        }
        if (code.includes('Used to personalize the final answer')) {
          await (
            globals?.used as (id: unknown, reason?: unknown) => Promise<void>
          )('coffee', 'Used to personalize the final answer');
        }
        if (code.includes('used("skill:planning")')) {
          await (
            globals?.used as (id: unknown, reason?: unknown) => Promise<void>
          )('skill:planning');
        }
        if (code.includes('final("distilled"')) {
          (globals?.final as (...args: unknown[]) => void)('distilled', {
            note: 'coffee',
          });
        }
        if (code.includes('final("done"')) {
          (globals?.final as (...args: unknown[]) => void)('done', {
            answer: 'ok',
          });
        }
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
};

describe('AxAgent memory usage tracking', () => {
  it('reports actor-declared used memories separately from loaded memories', async () => {
    let distillerTurns = 0;
    const actorUserPrompts: string[] = [];
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req): Promise<AxChatResponse> => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');
        const userPrompt = String(req.chatPrompt[1]?.content ?? '');
        if (systemPrompt.includes('You (`distiller`)')) {
          actorUserPrompts.push(userPrompt);
          distillerTurns += 1;
          return {
            results: [
              {
                index: 0,
                content:
                  distillerTurns === 1
                    ? 'Javascript Code: await recall(["coffee"]); console.log("loaded")'
                    : [
                        'Javascript Code: await used("coffee", "Used to resolve the user preference"); await used("missing", "Should be ignored"); final("distilled", {"note":"coffee"})',
                      ].join('\n'),
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }
        if (systemPrompt.includes('You (`executor`)')) {
          actorUserPrompts.push(userPrompt);
          return {
            results: [
              {
                index: 0,
                content: [
                  'Javascript Code: await used("coffee", "Used to personalize the final answer"); final("done", {"answer":"ok"})',
                ].join('\n'),
                finishReason: 'stop',
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
              finishReason: 'stop',
            },
          ],
          modelUsage: makeModelUsage(),
        };
      },
    });
    const onLoadedMemories = vi.fn();
    const onUsedMemories = vi.fn();
    const myAgent = agent('query:string -> answer:string', {
      contextFields: [],
      runtime: memoryRuntime,
      onMemoriesSearch: async () => [
        { id: 'coffee', content: 'User prefers coffee routines.' },
      ],
      onLoadedMemories,
    });

    await myAgent.forward(
      ai,
      { query: 'Make it personal' },
      { onUsedMemories }
    );

    expect(onLoadedMemories).toHaveBeenCalledWith([
      { id: 'coffee', content: 'User prefers coffee routines.' },
    ]);
    expect(
      actorUserPrompts.some((prompt) =>
        prompt.includes(
          'Memories: ### Memory\n\nID: `coffee`\n\nUser prefers coffee routines.'
        )
      )
    ).toBe(true);
    expect(onUsedMemories).toHaveBeenCalledWith([
      {
        id: 'coffee',
        reason: 'Used to resolve the user preference',
        stage: 'distiller',
      },
      {
        id: 'coffee',
        reason: 'Used to personalize the final answer',
        stage: 'executor',
      },
    ]);
  });

  it('reports actor-declared used skills', async () => {
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req): Promise<AxChatResponse> => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');
        if (systemPrompt.includes('You (`distiller`)')) {
          return {
            results: [
              {
                index: 0,
                content: 'Javascript Code: final("distilled", {})',
                finishReason: 'stop',
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
                content:
                  'Javascript Code: await used("skill:planning"); final("done", {"answer":"ok"})',
                finishReason: 'stop',
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
              finishReason: 'stop',
            },
          ],
          modelUsage: makeModelUsage(),
        };
      },
    });
    const onUsedSkills = vi.fn();
    const myAgent = agent('query:string -> answer:string', {
      contextFields: [],
      runtime: memoryRuntime,
      skills: [
        {
          id: 'skill:planning',
          name: 'Planning',
          content: 'Use for planning.',
        },
      ],
    });

    await myAgent.forward(ai, { query: 'Make a plan' }, { onUsedSkills });

    expect(onUsedSkills).toHaveBeenCalledWith([
      {
        id: 'skill:planning',
        name: 'Planning',
        stage: 'executor',
      },
    ]);
  });
});
