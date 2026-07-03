import { describe, expect, it, vi } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import type { AxChatResponse } from '../ai/types.js';
import { AxAgentContextMap, agent } from './index.js';
import type { AxCodeRuntime } from './rlm.js';

const makeModelUsage = () => ({
  ai: 'mock',
  model: 'mock',
  tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
});

const contextMapRuntime: AxCodeRuntime = {
  // Scripted fake: opt out of the shared-session protocol.
  supportsSharedSessions: false,
  getUsageInstructions: () => '',
  createSession(globals) {
    return {
      execute: async (code: string) => {
        if (code.includes('final("distilled"')) {
          (globals?.final as (...args: unknown[]) => void)('distilled', {
            section: 'billing',
          });
        }
        if (code.includes('final("done"')) {
          (globals?.final as (...args: unknown[]) => void)('done', {
            answer: 'ok',
          });
        }
        return 'executed';
      },
      patchGlobals: async () => {},
      close: () => {},
    };
  },
};

describe('AxAgentContextMap', () => {
  it('applies operations and round-trips snapshots', () => {
    const map = new AxAgentContextMap(undefined, {
      infiniteEvolve: false,
      evolveSteps: 5,
      maxChars: 2_000,
    });

    const result = map.applyUpdatePayload({
      diagnosis: 'Found reusable structure.',
      operations: [
        {
          type: 'ADD',
          section: 'context_understanding',
          content: 'Billing records are grouped by account id.',
        },
      ],
    });

    expect(result.changed).toBe(true);
    expect(result.status).toBe('updated');
    expect(result.step).toBe(1);
    expect(map.text).toContain('[cu-00001] Billing records');

    const replaceResult = map.applyUpdatePayload({
      operations: [
        {
          type: 'REPLACE',
          item_id: 'cu-00001',
          content: 'Billing records are grouped by customer id.',
        },
      ],
    });

    expect(replaceResult.changed).toBe(true);
    expect(map.text).toContain('[cu-00001] Billing records are grouped');
    expect(map.text).not.toContain('account id');

    const restored = AxAgentContextMap.fromSnapshot(map.snapshot());
    expect(restored.text).toBe(map.text);
    expect(restored.snapshot()).toMatchObject({
      infiniteEvolve: false,
      evolveSteps: 5,
      maxChars: 2_000,
      steps: 2,
    });
  });

  it('validates finite evolution options', () => {
    expect(
      () => new AxAgentContextMap(undefined, { infiniteEvolve: false })
    ).toThrow(/evolveSteps/);
    expect(
      () =>
        new AxAgentContextMap(undefined, {
          infiniteEvolve: false,
          evolveSteps: -1,
        })
    ).toThrow(/evolveSteps/);
    expect(() => new AxAgentContextMap(undefined, { maxChars: 0 })).toThrow(
      /maxChars/
    );
  });

  it('runs Distiller then Cartographer and defaults to infinite evolution', async () => {
    const calls: string[] = [];
    const policyPrompts: string[] = [];
    const map = new AxAgentContextMap();
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req): Promise<AxChatResponse> => {
        const promptText = JSON.stringify(req.chatPrompt);
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

        if (systemPrompt.includes('context-map Distiller')) {
          calls.push('distiller');
          policyPrompts.push(systemPrompt);
          expect(systemPrompt).toContain('Orientation work');
          expect(systemPrompt).toContain('Question-specific work');
          expect(systemPrompt).toContain(
            'Review every existing context-map item'
          );
          expect(systemPrompt).toContain('transferability');
          return {
            results: [
              {
                index: 0,
                content: [
                  'Diagnosis: Learned reusable billing structure.',
                  'Item Tags: {}',
                  'Cache Candidates: [{"section":"context_understanding","value":"Invoices are indexed by customer id.","transferability":"future invoice lookup questions","rationale":"This describes corpus structure, not the answer."}]',
                ].join('\n'),
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }

        if (systemPrompt.includes('context-map Cartographer')) {
          calls.push('cartographer');
          policyPrompts.push(systemPrompt);
          expect(systemPrompt).toContain('Value priority');
          expect(systemPrompt).toContain('Character budget triage');
          expect(systemPrompt).toContain('Do not add raw data dumps');
          expect(systemPrompt).toContain('item_id');
          expect(systemPrompt).toContain('shared-understanding litmus test');
          expect(promptText).toContain('Learned reusable billing structure');
          return {
            results: [
              {
                index: 0,
                content:
                  'Operations: [{"type":"ADD","section":"context_understanding","content":"Invoices are indexed by customer id."}]',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }

        throw new Error(`Unexpected prompt: ${systemPrompt}`);
      },
    });

    const first = await map.update(ai, {
      task: 'Understand invoices',
      trajectory: 'The agent found invoice records by customer id.',
    });
    const second = await map.update(ai, {
      task: 'Understand invoices again',
      trajectory: 'The agent reused the invoice index.',
    });

    expect(first.status).toBe('updated');
    expect(second.status).toBe('updated');
    expect(calls).toEqual([
      'distiller',
      'cartographer',
      'distiller',
      'cartographer',
    ]);
    expect(policyPrompts).toHaveLength(4);
  });

  it('does not cache one-off answers when Cartographer returns no operations', async () => {
    const calls: string[] = [];
    const map = new AxAgentContextMap();
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req): Promise<AxChatResponse> => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');
        if (systemPrompt.includes('context-map Distiller')) {
          calls.push('distiller');
          return {
            results: [
              {
                index: 0,
                content: [
                  'Diagnosis: The run only found a one-off answer.',
                  'Item Tags: {}',
                  'Cache Candidates: [{"section":"reusable_results","value":"The answer to the latest task is $42.17.","transferability":"none","rationale":"This only answers the current question."}]',
                ].join('\n'),
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }
        if (systemPrompt.includes('context-map Cartographer')) {
          calls.push('cartographer');
          return {
            results: [
              {
                index: 0,
                content: 'Operations: []',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }
        throw new Error(`Unexpected prompt: ${systemPrompt}`);
      },
    });

    const result = await map.update(ai, {
      task: 'What is the current total?',
      trajectory: 'The agent found only the requested total: $42.17.',
    });

    expect(calls).toEqual(['distiller', 'cartographer']);
    expect(result.status).toBe('unchanged');
    expect(result.operations).toEqual([]);
    expect(map.text).not.toContain('$42.17');
  });

  it('skips policy calls after finite evolve steps are exhausted', async () => {
    const calls: string[] = [];
    const map = new AxAgentContextMap(undefined, {
      infiniteEvolve: false,
      evolveSteps: 1,
    });
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req): Promise<AxChatResponse> => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');
        if (systemPrompt.includes('context-map Distiller')) {
          calls.push('distiller');
          return {
            results: [
              {
                index: 0,
                content:
                  'Diagnosis: Learned one item.\nItem Tags: {}\nCache Candidates: []',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }
        if (systemPrompt.includes('context-map Cartographer')) {
          calls.push('cartographer');
          return {
            results: [
              {
                index: 0,
                content:
                  'Operations: [{"type":"ADD","section":"context_understanding","content":"First reusable item."}]',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }
        throw new Error(`Unexpected prompt: ${systemPrompt}`);
      },
    });

    const first = await map.update(ai, {
      task: 'First run',
      trajectory: 'completed',
    });
    const second = await map.update(ai, {
      task: 'Second run',
      trajectory: 'completed',
    });

    expect(first.status).toBe('updated');
    expect(first.step).toBe(1);
    expect(second).toMatchObject({
      status: 'skipped',
      step: 1,
      skipReason: 'evolve_steps',
      changed: false,
    });
    expect(calls).toEqual(['distiller', 'cartographer']);
  });

  it('evicts low-scoring items before helpful items', () => {
    const map = AxAgentContextMap.fromText(
      [
        '## CONTEXT UNDERSTANDING',
        '[cu-00001] Important durable fact.',
        '[cu-00002] Disposable verbose fact.',
      ].join('\n'),
      { maxChars: 70 }
    );

    expect(map.tag('cu-00001', 'helpful')).toBe(true);
    expect(map.tag('cu-00002', 'harmful')).toBe(true);

    const result = map.applyUpdatePayload({ operations: [] });

    expect(result.status).toBe('updated');
    expect(map.text).toContain('[cu-00001]');
    expect(map.text).not.toContain('[cu-00002]');
  });

  it('injects the map into the distiller and updates it after a successful run', async () => {
    const map = AxAgentContextMap.fromText(
      '## CONTEXT UNDERSTANDING\n[cu-00001] Existing billing orientation.\n',
      { infiniteEvolve: false, evolveSteps: 1 }
    );
    const onUpdate = vi.fn();
    const distillerPrompts: string[] = [];
    const distillerUserPrompts: string[] = [];
    let distillerUpdaterCalls = 0;
    let cartographerCalls = 0;

    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req): Promise<AxChatResponse> => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

        if (systemPrompt.includes('context-map Distiller')) {
          distillerUpdaterCalls += 1;
          return {
            results: [
              {
                index: 0,
                content: [
                  'Diagnosis: Learned reusable billing structure.',
                  'Item Tags: {"cu-00001":"helpful"}',
                  'Cache Candidates: [{"section":"context_understanding","content":"Invoices are indexed by customer id."}]',
                ].join('\n'),
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }

        if (systemPrompt.includes('context-map Cartographer')) {
          cartographerCalls += 1;
          return {
            results: [
              {
                index: 0,
                content:
                  'Operations: [{"type":"ADD","section":"context_understanding","content":"Invoices are indexed by customer id."}]',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }

        if (systemPrompt.includes('You (`distiller`)')) {
          distillerPrompts.push(systemPrompt);
          distillerUserPrompts.push(
            req.chatPrompt
              .filter((msg) => msg.role === 'user')
              .map((msg) => String(msg.content ?? ''))
              .join('\n')
          );
          return {
            results: [
              {
                index: 0,
                content:
                  'Javascript Code: final("distilled", {"section":"billing"})',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }

        if (systemPrompt.includes('You (`executor`)')) {
          expect(systemPrompt).not.toContain('Existing billing orientation');
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

    const myAgent = agent('context:string, query:string -> answer:string', {
      contextFields: ['context'],
      runtime: contextMapRuntime,
      contextMap: { map, onUpdate },
    });

    const result = await myAgent.forward(ai, {
      context: 'Long billing corpus',
      query: 'How are invoices organized?',
    });
    const frozenResult = await myAgent.forward(ai, {
      context: 'Long billing corpus',
      query: 'Which field points to the customer?',
    });

    expect(result.answer).toBe('ok');
    expect(frozenResult.answer).toBe('ok');
    expect(distillerPrompts[0]).toContain('### Context Map');
    expect(distillerPrompts[0]).not.toContain('Existing billing orientation');
    expect(distillerUserPrompts[0]).toContain('Context Map:');
    expect(distillerUserPrompts[0]).toContain('Existing billing orientation');
    expect(distillerUpdaterCalls).toBe(1);
    expect(cartographerCalls).toBe(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0]?.[0]).toMatchObject({
      status: 'updated',
      step: 1,
    });
    expect(map.text).toContain('Invoices are indexed by customer id.');
  });

  it('rebuilds the distiller actor inputs when a context map is attached after construction', async () => {
    const distillerPrompts: string[] = [];
    const distillerUserPrompts: string[] = [];

    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req): Promise<AxChatResponse> => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

        if (systemPrompt.includes('You (`distiller`)')) {
          distillerPrompts.push(systemPrompt);
          distillerUserPrompts.push(
            req.chatPrompt
              .filter((msg) => msg.role === 'user')
              .map((msg) => String(msg.content ?? ''))
              .join('\n')
          );
          return {
            results: [
              {
                index: 0,
                content:
                  'Javascript Code: final("distilled", {"section":"billing"})',
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
                content: 'Javascript Code: final("done", {"answer":"ok"})',
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

    const myAgent = agent('context:string, query:string -> answer:string', {
      contextFields: ['context'],
      runtime: contextMapRuntime,
    });
    myAgent.setContextMap(
      new AxAgentContextMap(
        '## CONTEXT UNDERSTANDING\n[cu-00001] Late billing orientation.\n',
        { infiniteEvolve: false, evolveSteps: 0 }
      )
    );

    const result = await myAgent.forward(ai, {
      context: 'Long billing corpus',
      query: 'How are invoices organized?',
    });

    expect(result.answer).toBe('ok');
    expect(distillerPrompts[0]).toContain('### Context Map');
    expect(distillerPrompts[0]).not.toContain('Late billing orientation');
    expect(distillerUserPrompts[0]).toContain('Context Map:');
    expect(distillerUserPrompts[0]).toContain('Late billing orientation');
  });
});
