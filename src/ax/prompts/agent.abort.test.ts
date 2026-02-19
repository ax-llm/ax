import { describe, expect, it } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import type { AxChatResponse } from '../ai/types.js';
import { AxAIServiceAbortedError } from '../util/apicall.js';

import { AxAgent } from './agent.js';
import type { AxCodeRuntime } from './rlm.js';

const makeModelUsage = () => ({
  ai: 'mock',
  model: 'mock',
  tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
});

const createSimpleRuntime = (): AxCodeRuntime => ({
  createSession() {
    return {
      execute: async (code: string) => {
        if (code.trim() === 'done()') return 'done()';
        return `executed: ${code}`;
      },
      close: () => {},
    };
  },
});

describe('AxAgent.stop()', () => {
  it('throws when stop() is called during Actor loop execution', async () => {
    let actorCallCount = 0;

    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req): Promise<AxChatResponse> => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          actorCallCount++;
          // Always return code (never done()) so the loop continues
          return {
            results: [
              {
                index: 0,
                content: `Javascript Code: "step ${actorCallCount}"`,
                finishReason: 'stop',
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
              content: 'Answer: done',
              finishReason: 'stop',
            },
          ],
          modelUsage: makeModelUsage(),
        };
      },
    });

    let stopCalled = false;
    const runtime: AxCodeRuntime = {
      createSession() {
        return {
          execute: async () => {
            if (!stopCalled) {
              stopCalled = true;
              myAgent.stop();
            }
            return 'executed';
          },
          close: () => {},
        };
      },
    };

    const myAgent = new AxAgent(
      {
        signature: 'userQuery:string -> answer:string',
      },
      {
        maxSteps: 10,
        rlm: { contextFields: [], runtime, maxTurns: 5 },
      }
    );

    await expect(myAgent.forward(ai, { userQuery: 'test' })).rejects.toThrow();
  });

  it('throws when external abort signal is triggered', async () => {
    const controller = new AbortController();
    let actorCallCount = 0;

    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req): Promise<AxChatResponse> => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          actorCallCount++;
          if (actorCallCount === 1) {
            controller.abort('external abort');
          }
          return {
            results: [
              {
                index: 0,
                content: 'Javascript Code: "step"',
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
              content: 'Answer: done',
              finishReason: 'stop',
            },
          ],
          modelUsage: makeModelUsage(),
        };
      },
    });

    const myAgent = new AxAgent(
      {
        signature: 'userQuery:string -> answer:string',
      },
      {
        maxSteps: 10,
        rlm: { contextFields: [], runtime: createSimpleRuntime(), maxTurns: 5 },
      }
    );

    await expect(
      myAgent.forward(
        ai,
        { userQuery: 'test' },
        { abortSignal: controller.signal }
      )
    ).rejects.toThrow();
  });

  it('throws when stop() is called before forward()', async () => {
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
    });

    const myAgent = new AxAgent(
      {
        signature: 'userQuery:string -> answer:string',
      },
      {
        maxSteps: 10,
        rlm: { contextFields: [], runtime: createSimpleRuntime(), maxTurns: 5 },
      }
    );

    // Call stop before forward
    myAgent.stop();

    await expect(myAgent.forward(ai, { userQuery: 'test' })).rejects.toThrow();
  });

  it('propagates abortSignal through the Actor loop', async () => {
    let runtimeReceivedAbort = false;
    const controller = new AbortController();

    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req): Promise<AxChatResponse> => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          return {
            results: [
              {
                index: 0,
                content: 'Javascript Code: "check abort"',
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
              content: 'Answer: done',
              finishReason: 'stop',
            },
          ],
          modelUsage: makeModelUsage(),
        };
      },
    });

    const runtime: AxCodeRuntime = {
      createSession() {
        return {
          execute: async (_code: string, opts?: { signal?: AbortSignal }) => {
            if (opts?.signal) {
              runtimeReceivedAbort = true;
            }
            // Abort after first execution to trigger abort path
            controller.abort('test abort');
            return 'executed';
          },
          close: () => {},
        };
      },
    };

    const myAgent = new AxAgent(
      {
        signature: 'userQuery:string -> answer:string',
      },
      {
        maxSteps: 5,
        rlm: { contextFields: [], runtime, maxTurns: 3 },
      }
    );

    await myAgent
      .forward(ai, { userQuery: 'test' }, { abortSignal: controller.signal })
      .catch(() => {
        /* expected to throw due to abort */
      });

    // The runtime should have received the signal
    expect(runtimeReceivedAbort).toBe(true);
  });

  it('aborts when stop() is called during forward execution', async () => {
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (): Promise<AxChatResponse> => {
        // Slow response to allow stop to be called
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          results: [
            {
              index: 0,
              content: 'Javascript Code: "step"',
              finishReason: 'stop',
            },
          ],
          modelUsage: makeModelUsage(),
        };
      },
    });

    const myAgent = new AxAgent(
      {
        signature: 'userQuery:string -> answer:string',
      },
      {
        rlm: { contextFields: [], runtime: createSimpleRuntime(), maxTurns: 5 },
      }
    );

    const pending = myAgent.forward(ai, { userQuery: 'test' });

    // Let the forward start, then stop
    await new Promise((resolve) => setTimeout(resolve, 10));
    myAgent.stop();

    await expect(pending).rejects.toBeInstanceOf(AxAIServiceAbortedError);
  });
});
