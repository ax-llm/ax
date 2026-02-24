import { describe, expect, it } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import type { AxFunctionJSONSchema } from '../ai/types.js';
import { toFieldType } from '../dsp/prompt.js';
import type { AxIField } from '../dsp/sig.js';
import { s } from '../dsp/template.js';
import { AxAIServiceAbortedError } from '../util/apicall.js';

import { AxAgent, agent } from './agent.js';
import type { AxCodeRuntime } from './rlm.js';
import { axBuildActorDefinition, axBuildResponderDefinition } from './rlm.js';

// ----- Helpers -----

const makeModelUsage = () => ({
  ai: 'mock-ai',
  model: 'mock-model',
  tokens: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
});

/** Minimal runtime for tests that don't exercise code execution */
const defaultRuntime: AxCodeRuntime = {
  getUsageInstructions: () => '',
  createSession(globals) {
    return {
      execute: async (code: string) => {
        if (globals?.final && code.includes('final(')) {
          (globals.final as (...args: unknown[]) => void)('done');
        }
        if (globals?.ask_clarification && code.includes('ask_clarification(')) {
          (globals.ask_clarification as (...args: unknown[]) => void)(
            'clarification'
          );
        }
        return 'ok';
      },
      close: () => {},
    };
  },
};

/** Default rlm config for tests that don't need RLM behavior */
const defaultRlmFields = {
  contextFields: [] as string[],
  runtime: defaultRuntime,
};

// ----- AxAgent basic tests -----

describe('AxAgent', () => {
  it('should throw when getFunction() called without agentIdentity', () => {
    const a = new AxAgent(
      {
        signature: 'userQuery: string -> agentResponse: string',
      },
      { ...defaultRlmFields }
    );

    expect(() => a.getFunction()).toThrow(/agentIdentity/);
  });

  it('should append additional text to Actor prompt via actorOptions.description', () => {
    const a = new AxAgent(
      {
        signature: 'query: string -> answer: string',
      },
      {
        ...defaultRlmFields,
        actorOptions: { description: 'Always prefer concise code.' },
      }
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actorDesc = (a as any).actorProgram
      .getSignature()
      .getDescription() as string;
    // Should contain the base RLM prompt
    expect(actorDesc).toContain('Code Generation Agent');
    // Should also contain the appended text
    expect(actorDesc).toContain('Always prefer concise code.');
  });

  it('should throw when signature has a description set', () => {
    const sig = s('query: string -> answer: string');
    sig.setDescription('You are a helpful weather assistant');

    expect(
      () =>
        new AxAgent(
          {
            signature: sig,
          },
          { ...defaultRlmFields }
        )
    ).toThrow(/does not support signature-level descriptions/);
  });

  it('should append additional text to Responder prompt via responderOptions.description', () => {
    const a = new AxAgent(
      {
        signature: 'query: string -> answer: string',
      },
      {
        ...defaultRlmFields,
        responderOptions: { description: 'Always respond in bullet points.' },
      }
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const responderDesc = (a as any).responderProgram
      .getSignature()
      .getDescription() as string;
    // Should contain the base RLM prompt
    expect(responderDesc).toContain('Answer Synthesis Agent');
    // Should also contain the appended text
    expect(responderDesc).toContain('Always respond in bullet points.');
  });

  it('should allow independent actor and responder descriptions', () => {
    const a = new AxAgent(
      {
        signature: 'query: string -> answer: string',
      },
      {
        ...defaultRlmFields,
        actorOptions: { description: 'Actor-specific guidance.' },
        responderOptions: { description: 'Responder-specific guidance.' },
      }
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actorDesc = (a as any).actorProgram
      .getSignature()
      .getDescription() as string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const responderDesc = (a as any).responderProgram
      .getSignature()
      .getDescription() as string;

    expect(actorDesc).toContain('Actor-specific guidance.');
    expect(actorDesc).not.toContain('Responder-specific guidance.');

    expect(responderDesc).toContain('Responder-specific guidance.');
    expect(responderDesc).not.toContain('Actor-specific guidance.');
  });
});

// ----- Split architecture signature derivation -----

describe('Split-architecture signature derivation', () => {
  const runtime: AxCodeRuntime = {
    getUsageInstructions: () => '',
    createSession() {
      return { execute: async () => 'ok', close: () => {} };
    },
  };

  it('should derive Actor signature with actionLog input and code output', () => {
    const testAgent = agent('context:string, query:string -> answer:string', {
      contextFields: ['context'],
      runtime,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actorSig = (testAgent as any).actorProgram.getSignature();
    const inputs = actorSig.getInputFields();
    const outputs = actorSig.getOutputFields();

    // Inputs: query (original minus context), contextMetadata, actionLog
    expect(inputs.find((f: AxIField) => f.name === 'query')).toBeDefined();
    expect(
      inputs.find((f: AxIField) => f.name === 'contextMetadata')
    ).toBeDefined();
    expect(inputs.find((f: AxIField) => f.name === 'actionLog')).toBeDefined();
    expect(inputs.find((f: AxIField) => f.name === 'context')).toBeUndefined();

    // Outputs: only code field
    expect(outputs).toHaveLength(1);
    expect(outputs[0].name).toBe('javascriptCode');
  });

  it('should only have javascriptCode output when trajectoryPruning is enabled', () => {
    const testAgent = agent('context:string, query:string -> answer:string', {
      contextFields: ['context'],
      runtime,
      trajectoryPruning: true,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actorSig = (testAgent as any).actorProgram.getSignature();
    const outputs = actorSig.getOutputFields();

    // trajectoryPruning does not affect the signature -- still just javascriptCode
    expect(outputs).toHaveLength(1);
    expect(outputs[0].name).toBe('javascriptCode');
  });

  it('should derive Responder signature with original outputs', () => {
    const testAgent = agent(
      'context:string, query:string -> answer:string, confidence:number',
      {
        contextFields: ['context'],
        runtime,
      }
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const responderSig = (testAgent as any).responderProgram.getSignature();
    const inputs = responderSig.getInputFields();
    const outputs = responderSig.getOutputFields();

    // Responder inputs include non-context input fields and contextData
    expect(inputs.find((f: AxIField) => f.name === 'query')).toBeDefined();
    expect(inputs.find((f: AxIField) => f.name === 'context')).toBeUndefined();
    expect(
      inputs.find((f: AxIField) => f.name === 'contextData')
    ).toBeDefined();

    // Responder outputs are the original business outputs
    expect(outputs.find((f: AxIField) => f.name === 'answer')).toBeDefined();
    expect(
      outputs.find((f: AxIField) => f.name === 'confidence')
    ).toBeDefined();
  });

  it('should work with no context fields', () => {
    const testAgent = agent('query:string -> answer:string', {
      contextFields: [],
      runtime,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actorSig = (testAgent as any).actorProgram.getSignature();
    const inputs = actorSig.getInputFields();

    // All original inputs preserved (none removed as context)
    expect(inputs.find((f: AxIField) => f.name === 'query')).toBeDefined();
  });
});

// ----- Actor/Responder execution loop -----

describe('Actor/Responder execution loop', () => {
  it('should exit loop when Actor returns final(...)', async () => {
    let actorCallCount = 0;
    let responderCalled = false;

    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

        if (systemPrompt.includes('Answer the query')) {
          // llmQuery sub-call
          return {
            results: [
              { index: 0, content: 'sub-answer', finishReason: 'stop' },
            ],
            modelUsage: makeModelUsage(),
          };
        }

        if (systemPrompt.includes('Code Generation Agent')) {
          actorCallCount++;
          if (actorCallCount === 1) {
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: var x = 42; x',
                  finishReason: 'stop',
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }
          // Second call: signal submit
          return {
            results: [
              {
                index: 0,
                content: 'Javascript Code: final("done")',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }

        if (systemPrompt.includes('Answer Synthesis Agent')) {
          responderCalled = true;
          return {
            results: [
              {
                index: 0,
                content: 'Answer: The answer is 42',
                finishReason: 'stop',
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
      createSession(globals) {
        return {
          execute: async (code: string) => {
            if (globals?.final && code.includes('final(')) {
              (globals.final as (...args: unknown[]) => void)('done');
              return 'done';
            }
            try {
              const parts = code
                .split(';')
                .map((part) => part.trim())
                .filter(Boolean);
              const lastExpression = parts.pop();
              if (!lastExpression) {
                return 'error';
              }
              const setup = parts.length > 0 ? `${parts.join(';')};` : '';
              const run = new Function(
                `"use strict";${setup}return (${lastExpression});`
              );
              return String(run());
            } catch {
              return 'error';
            }
          },
          close: () => {},
        };
      },
    };

    const testAgent = agent('context:string, query:string -> answer:string', {
      ai: testMockAI,
      contextFields: ['context'],
      runtime,
    });

    const result = await testAgent.forward(testMockAI, {
      context: 'some context',
      query: 'What is the answer?',
    });

    expect(actorCallCount).toBe(2);
    expect(responderCalled).toBe(true);
    expect(result.answer).toBe('The answer is 42');
  });

  it('should enforce maxTurns limit', async () => {
    let actorCallCount = 0;

    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          actorCallCount++;
          // Never return final() — always return code
          return {
            results: [
              {
                index: 0,
                content: `Javascript Code: var step${actorCallCount} = ${actorCallCount}`,
                finishReason: 'stop',
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
                content: 'Answer: forced answer after max turns',
                finishReason: 'stop',
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
      createSession() {
        return {
          execute: async () => 'ok',
          close: () => {},
        };
      },
    };

    const testAgent = agent('context:string, query:string -> answer:string', {
      ai: testMockAI,
      contextFields: ['context'],
      runtime,
      maxTurns: 3,
    });

    const result = await testAgent.forward(testMockAI, {
      context: 'unused',
      query: 'unused',
    });

    expect(actorCallCount).toBe(3);
    expect(result.answer).toBe('forced answer after max turns');
  });

  it('should send fallback contextData payload when no final()/ask_clarification() is called', async () => {
    let responderPrompt = '';

    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          return {
            results: [
              {
                index: 0,
                content: 'Javascript Code: var step = 1; step',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }

        if (systemPrompt.includes('Answer Synthesis Agent')) {
          responderPrompt = String(req.chatPrompt[1]?.content ?? '');
          return {
            results: [
              {
                index: 0,
                content: 'Answer: fallback path',
                finishReason: 'stop',
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
      createSession() {
        return {
          execute: async () => 'executed-step',
          close: () => {},
        };
      },
    };

    const testAgent = agent('context:string, query:string -> answer:string', {
      ai: testMockAI,
      contextFields: ['context'],
      runtime,
      maxTurns: 1,
    });

    await testAgent.forward(testMockAI, {
      context: 'unused',
      query: 'unused',
    });

    expect(responderPrompt).toContain('Context Data:');
    expect(responderPrompt).toContain('"type": "final"');
    expect(responderPrompt).toContain('Action 1:');
    expect(responderPrompt).toContain('```javascript');
    expect(responderPrompt).not.toContain('Action Log:');
  });

  it('should accumulate actionLog across turns', async () => {
    let lastResponderPayload = '';

    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          return {
            results: [
              {
                index: 0,
                content: 'Javascript Code: final("done")',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }

        if (systemPrompt.includes('Answer Synthesis Agent')) {
          // Capture the actorResult payload that was passed to the Responder
          const userPrompt = String(req.chatPrompt[1]?.content ?? '');
          lastResponderPayload = userPrompt;
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
        }

        return {
          results: [{ index: 0, content: 'fallback', finishReason: 'stop' }],
          modelUsage: makeModelUsage(),
        };
      },
    });

    const runtime: AxCodeRuntime = {
      getUsageInstructions: () => '',
      createSession(globals) {
        return {
          execute: async (code: string) => {
            if (globals?.final && code.includes('final(')) {
              (globals.final as (...args: unknown[]) => void)('done');
            }
            return 'executed';
          },
          close: () => {},
        };
      },
    };

    const testAgent = agent('context:string, query:string -> answer:string', {
      ai: testMockAI,
      contextFields: ['context'],
      runtime,
    });

    await testAgent.forward(testMockAI, {
      context: 'unused',
      query: 'unused',
    });

    expect(lastResponderPayload).toContain('Context Data:');
    expect(lastResponderPayload).toContain('"type": "final"');
    expect(lastResponderPayload).toContain('"done"');
  });

  it('should prune error entries from actionLog after a successful turn when trajectoryPruning is enabled', async () => {
    let actorCallCount = 0;
    let thirdActorPrompt = '';

    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          actorCallCount++;
          if (actorCallCount === 1) {
            // Turn 1: code that will trigger an error
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: triggerError()',
                  finishReason: 'stop',
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }
          if (actorCallCount === 2) {
            // Turn 2: code that succeeds
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: var x = 42; x',
                  finishReason: 'stop',
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }

          // Turn 3: capture prompt, then finalize
          thirdActorPrompt = String(req.chatPrompt[1]?.content ?? '');
          return {
            results: [
              {
                index: 0,
                content: 'Javascript Code: final("done")',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }

        if (systemPrompt.includes('Answer Synthesis Agent')) {
          return {
            results: [
              { index: 0, content: 'Answer: pruned', finishReason: 'stop' },
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

    const testRuntime: AxCodeRuntime = {
      getUsageInstructions: () => '',
      createSession(globals) {
        return {
          execute: async (code: string) => {
            if (globals?.final && code.includes('final(')) {
              (globals.final as (...args: unknown[]) => void)('done');
              return 'done';
            }
            if (code.includes('triggerError')) {
              throw new Error('Execution timed out');
            }
            return '42';
          },
          close: () => {},
        };
      },
    };

    const testAgent = agent('context:string, query:string -> answer:string', {
      ai: testMockAI,
      contextFields: ['context'],
      runtime: testRuntime,
      trajectoryPruning: true,
    });

    await testAgent.forward(testMockAI, {
      context: 'unused',
      query: 'unused',
    });

    // The error from turn 1 should be pruned after the successful turn 2
    expect(thirdActorPrompt).not.toContain('triggerError');
    // The successful turn 2 should still be present
    expect(thirdActorPrompt).toContain('var x = 42');
    // Action log should always use code block format
    expect(thirdActorPrompt).toContain('```javascript');
  });

  it('should prune error entries when contextManagement.errorPruning is enabled (same as trajectoryPruning)', async () => {
    let actorCallCount = 0;
    let thirdActorPrompt = '';

    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          actorCallCount++;
          if (actorCallCount === 1) {
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: triggerError()',
                  finishReason: 'stop',
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }
          if (actorCallCount === 2) {
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: var y = 99; y',
                  finishReason: 'stop',
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }

          thirdActorPrompt = String(req.chatPrompt[1]?.content ?? '');
          return {
            results: [
              {
                index: 0,
                content: 'Javascript Code: final("done")',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }

        if (systemPrompt.includes('Answer Synthesis Agent')) {
          return {
            results: [
              { index: 0, content: 'Answer: pruned', finishReason: 'stop' },
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

    const testRuntime: AxCodeRuntime = {
      getUsageInstructions: () => '',
      createSession(globals) {
        return {
          execute: async (code: string) => {
            if (globals?.final && code.includes('final(')) {
              (globals.final as (...args: unknown[]) => void)('done');
              return 'done';
            }
            if (code.includes('triggerError')) {
              throw new Error('Execution timed out');
            }
            return '99';
          },
          close: () => {},
        };
      },
    };

    const testAgent = agent('context:string, query:string -> answer:string', {
      ai: testMockAI,
      contextFields: ['context'],
      runtime: testRuntime,
      contextManagement: { errorPruning: true },
    });

    await testAgent.forward(testMockAI, {
      context: 'unused',
      query: 'unused',
    });

    // The error from turn 1 should be pruned after the successful turn 2
    expect(thirdActorPrompt).not.toContain('triggerError');
    // The successful turn 2 should still be present
    expect(thirdActorPrompt).toContain('var y = 99');
  });

  it('should include inspect_runtime in actor definition when stateInspection is configured', () => {
    const testAgent = agent('context:string, query:string -> answer:string', {
      contextFields: ['context'],
      runtime: defaultRuntime,
      contextManagement: { stateInspection: { contextThreshold: 500 } },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actorSig = (testAgent as any).actorProgram.getSignature();
    const definition = actorSig.getDescription();

    expect(definition).toContain('inspect_runtime');
  });

  it('should NOT include inspect_runtime in actor definition when stateInspection is not configured', () => {
    const testAgent = agent('context:string, query:string -> answer:string', {
      contextFields: ['context'],
      runtime: defaultRuntime,
      contextManagement: { errorPruning: true },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actorSig = (testAgent as any).actorProgram.getSignature();
    const definition = actorSig.getDescription();

    expect(definition).not.toContain('inspect_runtime');
  });

  it('should exit loop when Actor returns ask_clarification(...)', async () => {
    let actorCallCount = 0;
    let responderCalled = false;

    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          actorCallCount++;
          // Signal clarification request
          return {
            results: [
              {
                index: 0,
                content:
                  'Javascript Code: ask_clarification("Need additional context")',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }

        if (systemPrompt.includes('Answer Synthesis Agent')) {
          responderCalled = true;
          return {
            results: [
              {
                index: 0,
                content: 'Answer: backward compat result',
                finishReason: 'stop',
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

    const testAgent = agent('query:string -> answer:string', {
      ai: testMockAI,
      contextFields: [],
      runtime: defaultRuntime,
    });

    const result = await testAgent.forward(testMockAI, {
      query: 'test',
    });

    // Should exit on first call (not loop)
    expect(actorCallCount).toBe(1);
    expect(responderCalled).toBe(true);
    expect(result.answer).toBe('backward compat result');
  });
});

// ----- Functions as runtime globals -----

describe('Functions as runtime globals', () => {
  it('should expose registered functions as callable in the runtime', async () => {
    let functionCalled = false;
    let functionArg = '';

    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          return {
            results: [
              {
                index: 0,
                content:
                  'Javascript Code: var result = await myTool({ input: "test" }); result',
                finishReason: 'stop',
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
                content: 'Answer: tool result received',
                finishReason: 'stop',
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
      createSession(globals) {
        return {
          execute: async (code: string) => {
            // Simulate calling the tool function from globals
            if (globals?.myTool && code.includes('myTool')) {
              const toolFn = globals.myTool as (
                args: Record<string, unknown>
              ) => Promise<unknown>;
              return await toolFn({ input: 'test' });
            }
            return 'no tool call';
          },
          close: () => {},
        };
      },
    };

    const testAgent = agent('query:string -> answer:string', {
      ai: testMockAI,
      functions: [
        {
          name: 'myTool',
          description: 'A test tool function',
          parameters: {
            type: 'object',
            properties: {
              input: { type: 'string', description: 'Input value' },
            },
            required: ['input'],
          },
          func: async (args: Record<string, unknown>) => {
            functionCalled = true;
            functionArg = String(args.input ?? '');
            return 'tool-output';
          },
        },
      ],
      contextFields: [],
      runtime,
      maxTurns: 1,
    });

    await testAgent.forward(testMockAI, { query: 'test' });

    expect(functionCalled).toBe(true);
    expect(functionArg).toBe('test');
  });
});

// ----- final()/ask_clarification() as runtime globals -----

describe('final()/ask_clarification() as runtime globals', () => {
  it('should exit actor loop when final() is called inline with code', async () => {
    let actorCallCount = 0;
    let responderCalled = false;
    let executedCode = '';

    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          actorCallCount++;
          return {
            results: [
              {
                index: 0,
                content: 'Javascript Code: var x = 42; final("inline")',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }

        if (systemPrompt.includes('Answer Synthesis Agent')) {
          responderCalled = true;
          return {
            results: [
              {
                index: 0,
                content: 'Answer: inline done result',
                finishReason: 'stop',
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
      createSession(globals) {
        return {
          execute: async (code: string) => {
            executedCode = code;
            // Simulate calling the submit function from globals
            if (globals?.final && code.includes('final(')) {
              (globals.final as (...args: unknown[]) => void)('inline');
            }
            return 42;
          },
          close: () => {},
        };
      },
    };

    const testAgent = agent('query:string -> answer:string', {
      ai: testMockAI,
      contextFields: [],
      runtime,
    });

    const result = await testAgent.forward(testMockAI, { query: 'test' });

    // Actor should be called only once — final() signals exit after execution
    expect(actorCallCount).toBe(1);
    expect(responderCalled).toBe(true);
    expect(result.answer).toBe('inline done result');
    expect(executedCode).toContain('final("inline")');
  });

  it('should pass final and ask_clarification functions in session globals', async () => {
    let receivedGlobals: Record<string, unknown> = {};

    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          return {
            results: [
              {
                index: 0,
                content: 'Javascript Code: final("done")',
                finishReason: 'stop',
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
                content: 'Answer: globals test',
                finishReason: 'stop',
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
      createSession(globals) {
        receivedGlobals = globals ?? {};
        return {
          execute: async (code: string) => {
            if (globals?.final && code.includes('final(')) {
              (globals.final as (...args: unknown[]) => void)('done');
            }
            return 'ok';
          },
          close: () => {},
        };
      },
    };

    const testAgent = agent('query:string -> answer:string', {
      ai: testMockAI,
      contextFields: [],
      runtime,
    });

    await testAgent.forward(testMockAI, { query: 'test' });

    expect(receivedGlobals).toHaveProperty('final');
    expect(typeof receivedGlobals.final).toBe('function');
    expect(receivedGlobals).toHaveProperty('ask_clarification');
    expect(typeof receivedGlobals.ask_clarification).toBe('function');
  });

  it('should require at least one argument for final()', async () => {
    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          return {
            results: [
              {
                index: 0,
                content: 'Javascript Code: final()',
                finishReason: 'stop',
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
      createSession(globals) {
        return {
          execute: async () => {
            (globals?.final as (...args: unknown[]) => void)();
            return 'unreachable';
          },
          close: () => {},
        };
      },
    };

    const testAgent = agent('query:string -> answer:string', {
      ai: testMockAI,
      contextFields: [],
      runtime,
    });

    await expect(
      testAgent.forward(testMockAI, { query: 'test' })
    ).rejects.toThrow('final() requires at least one argument');
  });

  it('should require at least one argument for ask_clarification()', async () => {
    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          return {
            results: [
              {
                index: 0,
                content: 'Javascript Code: ask_clarification()',
                finishReason: 'stop',
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
      createSession(globals) {
        return {
          execute: async () => {
            (globals?.ask_clarification as (...args: unknown[]) => void)();
            return 'unreachable';
          },
          close: () => {},
        };
      },
    };

    const testAgent = agent('query:string -> answer:string', {
      ai: testMockAI,
      contextFields: [],
      runtime,
    });

    await expect(
      testAgent.forward(testMockAI, { query: 'test' })
    ).rejects.toThrow('ask_clarification() requires at least one argument');
  });
});

// ----- agent() factory function -----

describe('agent() factory function', () => {
  const mockAI = new AxMockAIService({
    features: { functions: false, streaming: false },
    chatResponse: {
      results: [
        { index: 0, content: 'Mocked AI response', finishReason: 'stop' },
      ],
      modelUsage: makeModelUsage(),
    },
  });

  it('should work with string signatures', () => {
    const testAgent = agent('userInput:string -> responseText:string', {
      ai: mockAI,
      ...defaultRlmFields,
    });

    expect(testAgent).toBeInstanceOf(AxAgent);
    expect(testAgent.getSignature().getInputFields()).toHaveLength(1);
    expect(testAgent.getSignature().getOutputFields()).toHaveLength(1);
    expect(testAgent.getSignature().getInputFields()[0]?.name).toBe(
      'userInput'
    );
    expect(testAgent.getSignature().getOutputFields()[0]?.name).toBe(
      'responseText'
    );
  });

  it('should work with AxSignature objects', () => {
    const signature = s('userInput:string -> responseText:string');
    const testAgent = agent(signature, {
      ai: mockAI,
      ...defaultRlmFields,
    });

    expect(testAgent).toBeInstanceOf(AxAgent);
    expect(testAgent.getSignature().getInputFields()[0]?.name).toBe(
      'userInput'
    );
    expect(testAgent.getSignature().getOutputFields()[0]?.name).toBe(
      'responseText'
    );
  });

  it('should handle both overloads seamlessly', () => {
    const stringSig = 'userInput:string -> agentOutput:string';
    const axSig = s('userInput:string -> agentOutput:string');

    const agent1 = agent(stringSig, {
      ai: mockAI,
      ...defaultRlmFields,
    });
    const agent2 = agent(axSig, {
      ai: mockAI,
      ...defaultRlmFields,
    });

    expect(agent1.getSignature().getInputFields()).toEqual(
      agent2.getSignature().getInputFields()
    );
    expect(agent1.getSignature().getOutputFields()).toEqual(
      agent2.getSignature().getOutputFields()
    );
  });

  it('should pass through all config options correctly', () => {
    const sig = s('userInput:string -> responseText:string');

    const testAgent = agent(sig, {
      agentIdentity: {
        name: 'configTestAgent',
        description: 'An agent to test configuration passing',
      },
      ai: mockAI,
      debug: true,
      ...defaultRlmFields,
    });

    expect(testAgent.getFunction().name).toBe('configtestagent');
    expect(testAgent.getFunction().description).toBe(
      'An agent to test configuration passing'
    );
  });
});

// ----- toFieldType tests (unchanged) -----

describe('toFieldType with object structure', () => {
  it('should render object with fields', () => {
    const result = toFieldType({
      name: 'object',
      fields: {
        id: { type: 'number' },
        title: { type: 'string' },
      },
    });
    expect(result).toBe('object { id: number, title: string }');
  });

  it('should render plain object without fields', () => {
    const result = toFieldType({ name: 'object' });
    expect(result).toBe('object');
  });

  it('should render nested object fields', () => {
    const result = toFieldType({
      name: 'object',
      fields: {
        name: { type: 'string' },
        address: {
          type: 'object',
          fields: {
            city: { type: 'string' },
            zip: { type: 'string' },
          },
        },
      },
    });
    expect(result).toBe(
      'object { name: string, address: object { city: string, zip: string } }'
    );
  });

  it('should render optional nested fields with ?', () => {
    const result = toFieldType({
      name: 'object',
      fields: {
        timeout: { type: 'number', isOptional: true },
        retries: { type: 'number', isOptional: true },
      },
    });
    expect(result).toBe('object { timeout?: number, retries?: number }');
  });

  it('should render array of objects with fields', () => {
    const result = toFieldType({
      name: 'object',
      isArray: true,
      fields: {
        id: { type: 'number' },
        name: { type: 'string' },
      },
    });
    expect(result).toBe(
      'json array of object { id: number, name: string } items'
    );
  });
});

// ----- axBuildActorDefinition tests -----

describe('axBuildActorDefinition', () => {
  it('should include Code Generation Agent header', () => {
    const result = axBuildActorDefinition(undefined, [], [], {});
    expect(result).toContain('## Code Generation Agent');
  });

  it('should render context field types', () => {
    const fields: AxIField[] = [
      { name: 'query', title: 'Query', type: { name: 'string' } },
    ];
    const result = axBuildActorDefinition(
      undefined,
      fields,
      [{ name: 'answer', title: 'Answer', type: { name: 'string' } }],
      {}
    );
    expect(result).toContain('- `query` (string)');
  });

  it('should include field descriptions', () => {
    const fields: AxIField[] = [
      {
        name: 'query',
        title: 'Query',
        type: { name: 'string' },
        description: "The user's search query",
      },
    ];
    const result = axBuildActorDefinition(
      undefined,
      fields,
      [{ name: 'answer', title: 'Answer', type: { name: 'string' } }],
      {}
    );
    expect(result).toContain("- `query` (string): The user's search query");
  });

  it('should document final()/ask_clarification() exit signals', () => {
    const result = axBuildActorDefinition(undefined, [], [], {});
    expect(result).toContain('final(...args)');
    expect(result).toContain('ask_clarification(...args)');
  });

  it('should document llmQuery API', () => {
    const result = axBuildActorDefinition(undefined, [], [], {});
    expect(result).toContain('await llmQuery(query:string');
    expect(result).toContain('await llmQuery([{');
  });

  it('should include configured maxLlmCalls in batched llmQuery docs', () => {
    const result = axBuildActorDefinition(undefined, [], [], {
      maxLlmCalls: 7,
    });
    expect(result).toContain('call limit of 7');
  });

  it('should append base definition', () => {
    const result = axBuildActorDefinition(
      'You are a helpful assistant.',
      [],
      [],
      {}
    );
    expect(result).toContain('You are a helpful assistant.');
  });
});

// ----- axBuildResponderDefinition tests -----

describe('axBuildResponderDefinition', () => {
  it('should include Answer Synthesis Agent header', () => {
    const result = axBuildResponderDefinition(undefined, []);
    expect(result).toContain('## Answer Synthesis Agent');
  });

  it('should list context variable metadata', () => {
    const fields: AxIField[] = [
      { name: 'documents', title: 'Documents', type: { name: 'string' } },
    ];
    const result = axBuildResponderDefinition(undefined, fields);
    expect(result).toContain('- `documents` (string)');
  });

  it('should instruct to base answer on actorResult evidence', () => {
    const result = axBuildResponderDefinition(undefined, []);
    expect(result).toContain(
      'Base your answer ONLY on evidence from actorResult payload arguments'
    );
  });

  it('should instruct to use available evidence', () => {
    const result = axBuildResponderDefinition(undefined, []);
    expect(result).toContain(
      'provide the best possible answer from available evidence'
    );
  });

  it('should append base definition', () => {
    const result = axBuildResponderDefinition('You are a precise analyst.', []);
    expect(result).toContain('You are a precise analyst.');
  });
});

// ----- RLM llmQuery runtime behavior -----

describe('RLM llmQuery runtime behavior', () => {
  it('should return per-item errors for batched llmQuery calls', async () => {
    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');
        const userPrompt = String(req.chatPrompt[1]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          if (userPrompt.includes('Query: unused')) {
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: BATCH_TEST',
                  finishReason: 'stop',
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }
          if (userPrompt.includes('Query: ok')) {
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: final("ok")',
                  finishReason: 'stop',
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }
          if (userPrompt.includes('Query: fail')) {
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: final("fail")',
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
                content: 'Javascript Code: final("done")',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }

        if (systemPrompt.includes('Answer Synthesis Agent')) {
          if (userPrompt.includes('Task: fail')) {
            throw new Error('boom');
          }
          if (userPrompt.includes('Task: ok')) {
            return {
              results: [
                { index: 0, content: 'Answer: ok', finishReason: 'stop' },
              ],
              modelUsage: makeModelUsage(),
            };
          }
          return {
            results: [
              { index: 0, content: 'Answer: done', finishReason: 'stop' },
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

    let batchResult: string[] = [];
    const runtime: AxCodeRuntime = {
      getUsageInstructions: () => '',
      createSession(globals) {
        return {
          execute: async (code: string) => {
            if (code === 'BATCH_TEST') {
              const llmQueryFn = globals?.llmQuery as (
                q: readonly { query: string; context?: string }[]
              ) => Promise<string[]>;
              batchResult = await llmQueryFn([
                { query: 'ok', context: 'ctx1' },
                { query: 'fail', context: 'ctx2' },
              ]);
              return JSON.stringify(batchResult);
            }

            if (globals?.final && code.includes('final(')) {
              if (code.includes('"ok"')) {
                (globals.final as (...args: unknown[]) => void)('ok');
              } else if (code.includes('"fail"')) {
                (globals.final as (...args: unknown[]) => void)('fail');
              } else {
                (globals.final as (...args: unknown[]) => void)('done');
              }
              return 'submitted';
            }

            return 'ok';
          },
          close: () => {},
        };
      },
    };

    const testAgent = agent('context:string, query:string -> answer:string', {
      ai: testMockAI,
      contextFields: ['context'],
      runtime,
      maxTurns: 1,
      mode: 'advanced',
    });

    await testAgent.forward(testMockAI, {
      context: 'unused',
      query: 'unused',
    });

    expect(batchResult[0]).toBe('ok');
    expect(batchResult[1]).toContain('boom');
  });

  it('should normalize single-object llmQuery({ query, context }) to positional args', async () => {
    let llmQueryResult = '';

    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');
        const userPrompt = String(req.chatPrompt[1]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          if (userPrompt.includes('Query: unused')) {
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: test',
                  finishReason: 'stop',
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }
          if (userPrompt.includes('Task: summarize this')) {
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: final("sub-lm-answer")',
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
                content: 'Javascript Code: final("done")',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }

        if (systemPrompt.includes('Answer Synthesis Agent')) {
          if (userPrompt.includes('Task: summarize this')) {
            return {
              results: [
                {
                  index: 0,
                  content: 'Answer: sub-lm-answer',
                  finishReason: 'stop',
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }
          return {
            results: [
              { index: 0, content: 'Answer: done', finishReason: 'stop' },
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
      createSession(globals) {
        return {
          execute: async (code: string) => {
            if (code === 'test') {
              const llmQueryFn = globals?.llmQuery as (q: {
                query: string;
                context?: string;
              }) => Promise<string>;
              llmQueryResult = await llmQueryFn({
                query: 'summarize this',
                context: 'some context',
              });
              return llmQueryResult;
            }

            if (globals?.final && code.includes('final(')) {
              if (code.includes('"sub-lm-answer"')) {
                (globals.final as (...args: unknown[]) => void)(
                  'sub-lm-answer'
                );
              } else {
                (globals.final as (...args: unknown[]) => void)('done');
              }
              return 'submitted';
            }

            return 'ok';
          },
          close: () => {},
        };
      },
    };

    const testAgent = agent('context:string, query:string -> answer:string', {
      ai: testMockAI,
      contextFields: ['context'],
      runtime,
      maxTurns: 1,
      mode: 'advanced',
    });

    await testAgent.forward(testMockAI, {
      context: 'unused',
      query: 'unused',
    });

    expect(llmQueryResult).toBe('sub-lm-answer');
  });

  it('should throw typed aborted error from llmQuery pre-check', async () => {
    let abortResult = '';
    const abortController = new AbortController();

    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          // Actor: return code that calls llmQuery
          return {
            results: [
              {
                index: 0,
                content:
                  'Javascript Code: var r = await llmQuery("q", "ctx"); r',
                finishReason: 'stop' as const,
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }

        // Responder / llmQuery sub-call
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
          execute: async () => {
            // Abort before calling llmQuery so the pre-check fires
            abortController.abort('stop now');
            try {
              await (
                globals?.llmQuery as (
                  q: string,
                  context?: string
                ) => Promise<string>
              )('q', 'ctx');
              return 'unexpected success';
            } catch (err) {
              abortResult =
                err instanceof AxAIServiceAbortedError
                  ? 'aborted-ok'
                  : `wrong-type:${String(err)}`;
              return abortResult;
            }
          },
          close: () => {},
        };
      },
    };

    const testAgent = agent('context:string, query:string -> answer:string', {
      ai: testMockAI,
      contextFields: ['context'],
      runtime,
      maxTurns: 1,
    });

    try {
      await testAgent.forward(
        testMockAI,
        { context: 'unused', query: 'unused' },
        { abortSignal: abortController.signal }
      );
    } catch {
      // Expected: the forward itself may throw due to abort
    }

    // The llmQuery should have detected the abort
    expect(abortResult).toBe('aborted-ok');
  });
});

// ----- Session restart tests -----

describe('RLM session restart', () => {
  it('should restart closed session after timeout and restore globals', async () => {
    let createSessionCount = 0;
    let executeCount = 0;
    const runtime: AxCodeRuntime = {
      getUsageInstructions: () => '',
      createSession(globals?: Record<string, unknown>) {
        createSessionCount++;
        const safeGlobals = globals ?? {};
        return {
          execute: async () => {
            executeCount++;
            if (executeCount === 1) {
              throw new Error('Execution timed out');
            }
            if (executeCount === 2) {
              throw new Error('Session is closed');
            }
            return `ctx:${String(safeGlobals.context)};hasLlmQuery:${String(typeof safeGlobals.llmQuery === 'function')}`;
          },
          close: () => {},
        };
      },
    };

    let actorCallCount = 0;
    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          actorCallCount++;
          if (actorCallCount <= 2) {
            return {
              results: [
                {
                  index: 0,
                  content: `Javascript Code: execute_step_${actorCallCount}`,
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
                content: 'Javascript Code: final("done")',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }

        if (systemPrompt.includes('Answer Synthesis Agent')) {
          return {
            results: [
              { index: 0, content: 'Answer: done', finishReason: 'stop' },
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

    const testAgent = agent('context:string, query:string -> answer:string', {
      ai: testMockAI,
      contextFields: ['context'],
      runtime,
    });

    await testAgent.forward(testMockAI, {
      context: 'global-context',
      query: 'unused',
    });

    expect(createSessionCount).toBe(2); // initial + timeout-triggered restart
  });

  it('should not restart closed session if no timeout happened first', async () => {
    let createSessionCount = 0;
    const runtime: AxCodeRuntime = {
      getUsageInstructions: () => '',
      createSession() {
        createSessionCount++;
        return {
          execute: async () => {
            throw new Error('Session is closed');
          },
          close: () => {},
        };
      },
    };

    let actorCallCount = 0;
    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          actorCallCount++;
          if (actorCallCount === 1) {
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: some_code',
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
                content: 'Javascript Code: final("done")',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }

        if (systemPrompt.includes('Answer Synthesis Agent')) {
          return {
            results: [
              { index: 0, content: 'Answer: done', finishReason: 'stop' },
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

    const testAgent = agent('context:string, query:string -> answer:string', {
      ai: testMockAI,
      contextFields: ['context'],
      runtime,
    });

    await testAgent.forward(testMockAI, {
      context: 'unused',
      query: 'unused',
    });

    expect(createSessionCount).toBe(1); // No restart
  });
});

// ----- Program registration and optimization support -----

describe('Program registration for optimization', () => {
  it('should include Actor and Responder traces in getTraces()', async () => {
    let actorCallCount = 0;

    const mockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          actorCallCount++;
          if (actorCallCount === 1) {
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: "hello"',
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

        // Responder
        return {
          results: [
            {
              index: 0,
              content: 'Answer: traced result',
              finishReason: 'stop' as const,
            },
          ],
          modelUsage: makeModelUsage(),
        };
      },
    });

    const testAgent = new AxAgent(
      {
        signature: 'query:string -> answer:string',
      },
      { ...defaultRlmFields }
    );

    await testAgent.forward(mockAI, { query: 'test' });

    const traces = testAgent.getTraces();
    // Should have traces from both Actor and Responder (registered children)
    expect(traces.length).toBeGreaterThanOrEqual(2);

    // Each trace should have a programId
    for (const t of traces) {
      expect(t.programId).toBeDefined();
    }
  });

  it('should aggregate usage from Actor and Responder', async () => {
    let actorCallCount = 0;

    const mockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          actorCallCount++;
          return {
            results: [
              {
                index: 0,
                content:
                  actorCallCount === 1
                    ? 'Javascript Code: "step"'
                    : 'Javascript Code: final("done")',
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

    const testAgent = new AxAgent(
      {
        signature: 'query:string -> answer:string',
      },
      { ...defaultRlmFields }
    );

    await testAgent.forward(mockAI, { query: 'test' });

    const usage = testAgent.getUsage();
    // Should have usage entries (aggregated from Actor + Responder)
    expect(usage.length).toBeGreaterThan(0);
  });

  it('should reset usage for Actor and Responder', async () => {
    let actorCallCount = 0;

    const mockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          actorCallCount++;
          return {
            results: [
              {
                index: 0,
                content:
                  actorCallCount === 1
                    ? 'Javascript Code: "x"'
                    : 'Javascript Code: final("done")',
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

    const testAgent = new AxAgent(
      {
        signature: 'query:string -> answer:string',
      },
      { ...defaultRlmFields }
    );

    await testAgent.forward(mockAI, { query: 'test' });
    expect(testAgent.getUsage().length).toBeGreaterThan(0);

    testAgent.resetUsage();
    expect(testAgent.getUsage().length).toBe(0);
  });

  it('should expose both Actor and Responder via namedPrograms()', () => {
    const testAgent = new AxAgent(
      {
        signature: 'query:string -> answer:string',
      },
      { ...defaultRlmFields }
    );

    const programs = testAgent.namedPrograms();
    const ids = programs.map((p) => p.id);

    expect(ids).toContain('root.actor');
    expect(ids).toContain('root.responder');
  });

  it('should accept actor and responder demos via setDemos()', () => {
    const testAgent = new AxAgent(
      {
        signature: 'query:string -> answer:string',
      },
      { ...defaultRlmFields }
    );

    // Should not throw — demos have at least one input AND one output field
    testAgent.setDemos([
      {
        programId: 'root.actor' as const,
        traces: [
          {
            actionLog: '(no actions yet)',
            javascriptCode: 'console.log("hello")',
          },
        ],
      },
      {
        programId: 'root.responder' as const,
        traces: [{ query: 'test query', answer: 'The answer' }],
      },
    ]);
  });

  it('should accept actor demos with actorFields via setDemos()', () => {
    const testAgent = new AxAgent(
      {
        signature: 'query:string -> answer:string, reasoning:string',
      },
      { ...defaultRlmFields, actorFields: ['reasoning'] }
    );

    testAgent.setDemos([
      {
        programId: 'root.actor' as const,
        traces: [
          {
            actionLog: '(no actions yet)',
            javascriptCode: 'var x = 1',
            reasoning: 'Step-by-step analysis',
          },
        ],
      },
      {
        programId: 'root.responder' as const,
        traces: [{ query: 'test query', answer: 'The final answer' }],
      },
    ]);
  });

  it('should reject demos with no output field values', () => {
    const testAgent = new AxAgent(
      {
        signature: 'query:string -> answer:string',
      },
      { ...defaultRlmFields }
    );

    expect(() =>
      testAgent.setDemos([
        {
          programId: 'root.actor' as const,
          traces: [{ actionLog: '(no actions yet)' } as any],
        },
      ])
    ).toThrow(/no output field values/);
  });

  it('should reject demos with no input field values', () => {
    const testAgent = new AxAgent(
      {
        signature: 'query:string -> answer:string',
      },
      { ...defaultRlmFields }
    );

    expect(() =>
      testAgent.setDemos([
        {
          programId: 'root.actor' as const,
          traces: [{ javascriptCode: 'console.log("hello")' }],
        },
      ])
    ).toThrow(/no input field values/);
  });

  it('should reject responder demos with no input field values', () => {
    const testAgent = new AxAgent(
      {
        signature: 'query:string -> answer:string',
      },
      { ...defaultRlmFields }
    );

    expect(() =>
      testAgent.setDemos([
        {
          programId: 'root.responder' as const,
          traces: [{ answer: 'The answer' }],
        },
      ])
    ).toThrow(/no input field values/);
  });

  it('should validate demo field values using signature validators', () => {
    const testAgent = new AxAgent(
      {
        signature: 'query:string -> answer:string',
      },
      { ...defaultRlmFields }
    );

    // Boolean value for a string field should fail validation
    expect(() =>
      testAgent.setDemos([
        {
          programId: 'root.actor' as const,
          traces: [
            { actionLog: '(no actions yet)', javascriptCode: 123 } as any,
          ],
        },
      ])
    ).toThrow();
  });

  it('should render demos as few-shot examples in Actor/Responder prompts', async () => {
    let actorCallCount = 0;
    let actorPromptMessages: any[] = [];
    let responderPromptMessages: any[] = [];

    const mockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          actorCallCount++;
          actorPromptMessages = [...req.chatPrompt];
          return {
            results: [
              {
                index: 0,
                content:
                  actorCallCount === 1
                    ? 'Javascript Code: "hello"'
                    : 'Javascript Code: final("done")',
                finishReason: 'stop' as const,
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }

        // Responder
        responderPromptMessages = [...req.chatPrompt];
        return {
          results: [
            {
              index: 0,
              content: 'Answer: traced result',
              finishReason: 'stop' as const,
            },
          ],
          modelUsage: makeModelUsage(),
        };
      },
    });

    const testAgent = new AxAgent(
      {
        signature: 'query:string -> answer:string',
      },
      { ...defaultRlmFields }
    );

    testAgent.setDemos([
      {
        programId: 'root.actor' as const,
        traces: [
          {
            actionLog: '(no actions yet)',
            javascriptCode: 'console.log("demo-actor-trace")',
          },
        ],
      },
      {
        programId: 'root.responder' as const,
        traces: [{ query: 'test query', answer: 'demo-responder-trace' }],
      },
    ]);

    await testAgent.forward(mockAI, { query: 'test' });

    // Actor prompt should contain the actor demo trace
    const actorMessages = actorPromptMessages.map((m: any) =>
      typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    );
    const actorPromptText = actorMessages.join('\n');
    expect(actorPromptText).toContain('demo-actor-trace');

    // Responder prompt should contain the responder demo trace
    const responderMessages = responderPromptMessages.map((m: any) =>
      typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    );
    const responderPromptText = responderMessages.join('\n');
    expect(responderPromptText).toContain('demo-responder-trace');
  });
});

// ----- actorFields tests -----

describe('actorFields', () => {
  const runtime: AxCodeRuntime = {
    getUsageInstructions: () => '',
    createSession() {
      return { execute: async () => 'ok', close: () => {} };
    },
  };

  it('should split output fields between Actor and Responder based on actorFields', () => {
    const testAgent = agent(
      'context:string, query:string -> answer:string, reasoning:string, confidence:number',
      {
        contextFields: ['context'],
        runtime,
        actorFields: ['reasoning'],
      }
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actorSig = (testAgent as any).actorProgram.getSignature();
    const actorOutputs = actorSig.getOutputFields();

    // Actor should have javascriptCode + reasoning
    expect(
      actorOutputs.find((f: AxIField) => f.name === 'javascriptCode')
    ).toBeDefined();
    expect(
      actorOutputs.find((f: AxIField) => f.name === 'reasoning')
    ).toBeDefined();
    expect(actorOutputs).toHaveLength(2);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const responderSig = (testAgent as any).responderProgram.getSignature();
    const responderOutputs = responderSig.getOutputFields();

    // Responder should have answer + confidence (not reasoning)
    expect(
      responderOutputs.find((f: AxIField) => f.name === 'answer')
    ).toBeDefined();
    expect(
      responderOutputs.find((f: AxIField) => f.name === 'confidence')
    ).toBeDefined();
    expect(
      responderOutputs.find((f: AxIField) => f.name === 'reasoning')
    ).toBeUndefined();
    expect(responderOutputs).toHaveLength(2);
  });

  it('should throw for unknown actorField names', () => {
    expect(() =>
      agent('query:string -> answer:string', {
        contextFields: [],
        runtime,
        actorFields: ['nonexistent'],
      })
    ).toThrow(/actorField "nonexistent" not found in output signature/);
  });

  it('should keep Actor prompt focused on responder-owned fields when actorFields are set', () => {
    const testAgent = agent('query:string -> answer:string, reasoning:string', {
      contextFields: [],
      runtime,
      actorFields: ['reasoning'],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actorDesc = (testAgent as any).actorProgram
      .getSignature()
      .getDescription() as string;

    expect(actorDesc).toContain('Responder output fields');
    expect(actorDesc).toContain('`answer`');
    expect(actorDesc).not.toContain('Output ONLY a `javascriptCode` field');
  });

  it('should merge actorFieldValues into forward result', async () => {
    let actorCallCount = 0;

    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          actorCallCount++;
          if (actorCallCount === 1) {
            return {
              results: [
                {
                  index: 0,
                  content:
                    'Javascript Code: "gathering"\nReasoning: Step 1 analysis',
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
                content:
                  'Javascript Code: final("done")\nReasoning: Final reasoning',
                finishReason: 'stop',
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
                content: 'Answer: The final answer',
                finishReason: 'stop',
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

    const testAgent = agent('query:string -> answer:string, reasoning:string', {
      ai: testMockAI,
      contextFields: [],
      runtime,
      actorFields: ['reasoning'],
    });

    const result = await testAgent.forward(testMockAI, {
      query: 'test',
    });

    // answer comes from Responder, reasoning from last Actor turn
    expect(result.answer).toBe('The final answer');
    expect(result.reasoning).toBe('Final reasoning');
  });
});

// ----- actorCallback tests -----

describe('actorCallback', () => {
  const runtime: AxCodeRuntime = {
    getUsageInstructions: () => '',
    createSession(globals) {
      return {
        execute: async (code: string) => {
          if (globals?.final && code.includes('final(')) {
            (globals.final as (...args: unknown[]) => void)('done');
          }
          return 'ok';
        },
        close: () => {},
      };
    },
  };

  it('should call actorCallback on every Actor turn including final()', async () => {
    let actorCallCount = 0;
    const callbackResults: Record<string, unknown>[] = [];

    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          actorCallCount++;
          if (actorCallCount === 1) {
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: var x = 1',
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
                content: 'Javascript Code: final("done")',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }

        return {
          results: [
            { index: 0, content: 'Answer: done', finishReason: 'stop' },
          ],
          modelUsage: makeModelUsage(),
        };
      },
    });

    const testAgent = agent('query:string -> answer:string', {
      ai: testMockAI,
      contextFields: [],
      runtime,
      actorCallback: async (result) => {
        callbackResults.push(result);
      },
    });

    await testAgent.forward(testMockAI, { query: 'test' });

    // Callback should fire on both turns (code + submit)
    expect(callbackResults).toHaveLength(2);
    expect(callbackResults[0]?.javascriptCode).toBe('var x = 1');
    expect(callbackResults[1]?.javascriptCode).toBe('final("done")');
  });
});

// ----- actorOptions / responderOptions tests -----

describe('actorOptions / responderOptions', () => {
  const runtime: AxCodeRuntime = {
    getUsageInstructions: () => '',
    createSession() {
      return { execute: async () => 'ok', close: () => {} };
    },
  };

  it('should pass actorOptions to Actor forward calls', async () => {
    let capturedActorModel: string | undefined;

    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          capturedActorModel = req.model as string | undefined;
          return {
            results: [
              {
                index: 0,
                content: 'Javascript Code: final("done")',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }

        return {
          results: [
            { index: 0, content: 'Answer: done', finishReason: 'stop' },
          ],
          modelUsage: makeModelUsage(),
        };
      },
    });

    const testAgent = agent('query:string -> answer:string', {
      ai: testMockAI,
      contextFields: [],
      runtime,
      actorOptions: { model: 'actor-model' },
    });

    await testAgent.forward(testMockAI, { query: 'test' });

    expect(capturedActorModel).toBe('actor-model');
  });

  it('should pass responderOptions to Responder forward calls', async () => {
    let capturedResponderModel: string | undefined;

    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          return {
            results: [
              {
                index: 0,
                content: 'Javascript Code: final("done")',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }

        if (systemPrompt.includes('Answer Synthesis Agent')) {
          capturedResponderModel = req.model as string | undefined;
          return {
            results: [
              { index: 0, content: 'Answer: done', finishReason: 'stop' },
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

    const testAgent = agent('query:string -> answer:string', {
      ai: testMockAI,
      contextFields: [],
      runtime,
      responderOptions: { model: 'responder-model' },
    });

    await testAgent.forward(testMockAI, { query: 'test' });

    expect(capturedResponderModel).toBe('responder-model');
  });
});

// ----- recursionOptions and recursive parity tests -----

describe('recursionOptions and recursive parity', () => {
  it('should expose root tool globals inside recursive llmQuery child sessions', async () => {
    let recursiveToolCalled = false;

    const runtime: AxCodeRuntime = {
      getUsageInstructions: () => '',
      createSession(globals) {
        return {
          execute: async (code: string) => {
            if (code === 'ROOT_STEP') {
              const llmQueryFn = globals?.llmQuery as (
                q: string,
                context?: string
              ) => Promise<string>;
              return await llmQueryFn('child query', 'child context');
            }

            if (code === 'CHILD_STEP') {
              if (globals?.myTool) {
                recursiveToolCalled = true;
                const myTool = globals.myTool as (
                  args: Record<string, unknown>
                ) => Promise<unknown>;
                await myTool({ input: 'ok' });
              }
              if (globals?.final) {
                (globals.final as (...args: unknown[]) => void)('child answer');
              }
              return 'child done';
            }

            if (globals?.final && code.includes('final(')) {
              (globals.final as (...args: unknown[]) => void)('root done');
              return 'root done';
            }

            return 'ok';
          },
          close: () => {},
        };
      },
    };

    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');
        const userPrompt = String(req.chatPrompt[1]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          if (userPrompt.includes('Task: child query')) {
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: CHILD_STEP',
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
                content: 'Javascript Code: ROOT_STEP',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }

        if (systemPrompt.includes('Answer Synthesis Agent')) {
          return {
            results: [
              { index: 0, content: 'Answer: done', finishReason: 'stop' },
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

    const testAgent = agent('context:string, query:string -> answer:string', {
      ai: testMockAI,
      contextFields: ['context'],
      runtime,
      maxTurns: 1,
      mode: 'advanced',
      recursionOptions: {
        maxDepth: 2,
      },
      functions: [
        {
          name: 'myTool',
          description: 'recursive tool',
          parameters: {
            type: 'object',
            properties: {
              input: { type: 'string' },
            },
            required: ['input'],
          },
          func: async () => 'ok',
        },
      ],
    });

    await testAgent.forward(testMockAI, {
      context: 'root context',
      query: 'root query',
    });

    expect(recursiveToolCalled).toBe(true);
  });

  it('should NOT pass parent contextFields into recursive child runtime globals', async () => {
    let childResponderPrompt = '';

    const runtime: AxCodeRuntime = {
      getUsageInstructions: () => '',
      createSession(globals) {
        return {
          execute: async (code: string) => {
            if (code === 'ROOT_STEP') {
              const llmQueryFn = globals?.llmQuery as (
                q: string,
                context?: string
              ) => Promise<string>;
              const childResult = await llmQueryFn('child query');
              if (globals?.final) {
                (globals.final as (...args: unknown[]) => void)(childResult);
              }
              return childResult;
            }

            if (code === 'CHILD_CHECK') {
              const payload = {
                parentKnowledge:
                  (globals?.knowledge as string | undefined) ?? '',
                contextType: typeof globals?.context,
              };
              if (globals?.final) {
                (globals.final as (...args: unknown[]) => void)(payload);
              }
              return payload;
            }

            return 'ok';
          },
          close: () => {},
        };
      },
    };

    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');
        const userPrompt = String(req.chatPrompt[1]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          if (userPrompt.includes('Task: child query')) {
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: CHILD_CHECK',
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
                content: 'Javascript Code: ROOT_STEP',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }

        if (systemPrompt.includes('Answer Synthesis Agent')) {
          if (userPrompt.includes('Task: child query')) {
            childResponderPrompt = userPrompt;
            return {
              results: [
                {
                  index: 0,
                  content: 'Answer: child result',
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
                content: 'Answer: root result',
                finishReason: 'stop',
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

    const testAgent = agent('knowledge:string, query:string -> answer:string', {
      ai: testMockAI,
      contextFields: ['knowledge'],
      runtime,
      maxTurns: 1,
      mode: 'advanced',
      recursionOptions: {
        maxDepth: 2,
      },
    });

    await testAgent.forward(testMockAI, {
      knowledge: 'root-knowledge',
      query: 'root query',
    });

    // Child should NOT inherit parent's 'knowledge' context field
    expect(childResponderPrompt).toContain('"parentKnowledge": ""');
    // In advanced mode, context defaults to empty string when not provided
    expect(childResponderPrompt).toContain('"contextType": "string"');
  });

  it('should keep child final()/ask_clarification() signals isolated from parent state', async () => {
    let childSubmitActorCalls = 0;
    let childAskActorCalls = 0;
    let rootResponderPrompt = '';

    const runtime: AxCodeRuntime = {
      getUsageInstructions: () => '',
      createSession(globals) {
        return {
          execute: async (code: string) => {
            if (code === 'ROOT_NO_SIGNAL') {
              const llmQueryFn = globals?.llmQuery as (
                q: string,
                context?: string
              ) => Promise<string>;
              await llmQueryFn('child-submit', 'ctx');
              await llmQueryFn('child-ask', 'ctx');
              return 'root-finished';
            }
            return 'ok';
          },
          close: () => {},
        };
      },
    };

    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');
        const userPrompt = String(req.chatPrompt[1]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          if (userPrompt.includes('Task: child-submit')) {
            childSubmitActorCalls++;
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: final("child submit")',
                  finishReason: 'stop',
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }
          if (userPrompt.includes('Task: child-ask')) {
            childAskActorCalls++;
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: ask_clarification("child ask")',
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
                content: 'Javascript Code: ROOT_NO_SIGNAL',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }

        if (systemPrompt.includes('Answer Synthesis Agent')) {
          if (!userPrompt.includes('Task: child-')) {
            rootResponderPrompt = userPrompt;
          }
          return {
            results: [
              { index: 0, content: 'Answer: done', finishReason: 'stop' },
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

    const testAgent = agent('context:string, query:string -> answer:string', {
      ai: testMockAI,
      contextFields: ['context'],
      runtime,
      maxTurns: 1,
      mode: 'advanced',
      recursionOptions: {
        maxDepth: 2,
      },
    });

    await testAgent.forward(testMockAI, {
      context: 'root context',
      query: 'root query',
    });

    expect(childSubmitActorCalls).toBe(1);
    expect(childAskActorCalls).toBe(1);
    expect(rootResponderPrompt).toContain('"type": "final"');
    expect(rootResponderPrompt).toContain('```javascript');
    expect(rootResponderPrompt).toContain('ROOT_NO_SIGNAL');
  });

  it('should not carry actor/responder description options into recursive child prompts', async () => {
    let sawActorOverrideInChild = false;
    let sawResponderOverrideInChild = false;

    const runtime: AxCodeRuntime = {
      getUsageInstructions: () => '',
      createSession(globals) {
        return {
          execute: async (code: string) => {
            if (code === 'ROOT_STEP') {
              const llmQueryFn = globals?.llmQuery as (
                q: string,
                context?: string
              ) => Promise<string>;
              return await llmQueryFn('child query', 'child context');
            }
            if (globals?.final) {
              (globals.final as (...args: unknown[]) => void)('done');
            }
            return 'ok';
          },
          close: () => {},
        };
      },
    };

    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');
        const userPrompt = String(req.chatPrompt[1]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          if (userPrompt.includes('Task: child query')) {
            if (systemPrompt.includes('CHILD ACTOR OVERRIDE')) {
              sawActorOverrideInChild = true;
            }
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: final("child answer")',
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
                content: 'Javascript Code: ROOT_STEP',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }

        if (systemPrompt.includes('Answer Synthesis Agent')) {
          if (
            userPrompt.includes('Task: child query') &&
            systemPrompt.includes('CHILD RESPONDER OVERRIDE')
          ) {
            sawResponderOverrideInChild = true;
          }
          return {
            results: [
              { index: 0, content: 'Answer: done', finishReason: 'stop' },
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

    const testAgent = agent('context:string, query:string -> answer:string', {
      ai: testMockAI,
      contextFields: ['context'],
      runtime,
      maxTurns: 1,
      mode: 'advanced',
      actorOptions: {
        description: 'CHILD ACTOR OVERRIDE',
      },
      responderOptions: {
        description: 'CHILD RESPONDER OVERRIDE',
      },
      recursionOptions: {
        maxDepth: 2,
      },
    });

    await testAgent.forward(testMockAI, {
      context: 'root context',
      query: 'root query',
    });

    expect(sawActorOverrideInChild).toBe(false);
    expect(sawResponderOverrideInChild).toBe(false);
  });

  it('should return depth-limit error from llmQuery when recursionOptions.maxDepth is 0', async () => {
    let llmQueryResult = '';

    const runtime: AxCodeRuntime = {
      getUsageInstructions: () => '',
      createSession(globals) {
        return {
          execute: async (code: string) => {
            if (code === 'ROOT_STEP') {
              const llmQueryFn = globals?.llmQuery as (
                q: string,
                context?: string
              ) => Promise<string>;
              llmQueryResult = await llmQueryFn('child query', 'child context');
              if (globals?.final) {
                (globals.final as (...args: unknown[]) => void)(llmQueryResult);
              }
              return llmQueryResult;
            }
            return 'ok';
          },
          close: () => {},
        };
      },
    };

    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');
        if (systemPrompt.includes('Code Generation Agent')) {
          return {
            results: [
              {
                index: 0,
                content: 'Javascript Code: ROOT_STEP',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }
        return {
          results: [
            { index: 0, content: 'Answer: done', finishReason: 'stop' },
          ],
          modelUsage: makeModelUsage(),
        };
      },
    });

    const testAgent = agent('context:string, query:string -> answer:string', {
      ai: testMockAI,
      contextFields: ['context'],
      runtime,
      maxTurns: 1,
      recursionOptions: {
        maxDepth: 0,
      },
    });

    await testAgent.forward(testMockAI, {
      context: 'root context',
      query: 'root query',
    });

    expect(llmQueryResult).toContain('Recursion depth limit reached');
  });

  it('should use a fresh runtime session for each recursive llmQuery call', async () => {
    let childReadResponderPayload = '';

    const runtime: AxCodeRuntime = {
      getUsageInstructions: () => '',
      createSession(globals) {
        const sessionState: { marker?: string } = {};
        return {
          execute: async (code: string) => {
            if (code === 'ROOT_STEP') {
              const llmQueryFn = globals?.llmQuery as (
                q: string,
                context?: string
              ) => Promise<string>;
              await llmQueryFn('child-set', 'ctx');
              await llmQueryFn('child-read', 'ctx');
              if (globals?.final) {
                (globals.final as (...args: unknown[]) => void)('root done');
              }
              return 'root done';
            }

            if (code === 'CHILD_SET') {
              sessionState.marker = 'set';
              if (globals?.final) {
                (globals.final as (...args: unknown[]) => void)(
                  sessionState.marker
                );
              }
              return sessionState.marker;
            }

            if (code === 'CHILD_READ') {
              const marker = sessionState.marker ?? 'missing';
              if (globals?.final) {
                (globals.final as (...args: unknown[]) => void)(marker);
              }
              return marker;
            }

            return 'ok';
          },
          close: () => {},
        };
      },
    };

    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');
        const userPrompt = String(req.chatPrompt[1]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          if (userPrompt.includes('Task: child-set')) {
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: CHILD_SET',
                  finishReason: 'stop',
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }
          if (userPrompt.includes('Task: child-read')) {
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: CHILD_READ',
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
                content: 'Javascript Code: ROOT_STEP',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }

        if (systemPrompt.includes('Answer Synthesis Agent')) {
          if (userPrompt.includes('Task: child-read')) {
            childReadResponderPayload = userPrompt;
          }
          return {
            results: [
              { index: 0, content: 'Answer: done', finishReason: 'stop' },
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

    const testAgent = agent('context:string, query:string -> answer:string', {
      ai: testMockAI,
      contextFields: ['context'],
      runtime,
      maxTurns: 1,
      mode: 'advanced',
      recursionOptions: {
        maxDepth: 2,
      },
    });

    await testAgent.forward(testMockAI, {
      context: 'root context',
      query: 'root query',
    });

    // The second child call cannot see marker set by the first child call.
    expect(childReadResponderPayload).toContain('"missing"');
  });

  it('should propagate parent forward model to recursive llmQuery child by default', async () => {
    let childModel: string | undefined;

    const runtime: AxCodeRuntime = {
      getUsageInstructions: () => '',
      createSession(globals) {
        return {
          execute: async (code: string) => {
            if (code === 'ROOT_STEP') {
              const llmQueryFn = globals?.llmQuery as (
                q: string,
                context?: string
              ) => Promise<string>;
              await llmQueryFn('child query', 'child context');
              if (globals?.final) {
                (globals.final as (...args: unknown[]) => void)('root done');
              }
              return 'root done';
            }
            if (globals?.final) {
              (globals.final as (...args: unknown[]) => void)('child done');
            }
            return 'ok';
          },
          close: () => {},
        };
      },
    };

    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');
        const userPrompt = String(req.chatPrompt[1]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          if (userPrompt.includes('Task: child query')) {
            childModel = req.model as string | undefined;
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: final("child answer")',
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
                content: 'Javascript Code: ROOT_STEP',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }

        return {
          results: [
            { index: 0, content: 'Answer: done', finishReason: 'stop' },
          ],
          modelUsage: makeModelUsage(),
        };
      },
    });

    const testAgent = agent('context:string, query:string -> answer:string', {
      ai: testMockAI,
      contextFields: ['context'],
      runtime,
      maxTurns: 1,
      mode: 'advanced',
      recursionOptions: {
        maxDepth: 2,
      },
    });

    await testAgent.forward(
      testMockAI,
      {
        context: 'root context',
        query: 'root query',
      },
      { model: 'parent-model' }
    );

    expect(childModel).toBe('parent-model');
  });
});

// ----- A/An article grammar tests (unchanged) -----

describe('A/An article grammar in renderInputFields', () => {
  it('should use "An" before vowel-starting types like object', () => {
    const type = 'object { id: number }';
    const article = /^[aeiou]/i.test(type) ? 'An' : 'A';
    expect(article).toBe('An');
  });

  it('should use "A" before consonant-starting types like string', () => {
    const type = 'string';
    const article = /^[aeiou]/i.test(type) ? 'An' : 'A';
    expect(article).toBe('A');
  });

  it('should use "A" before number type', () => {
    const type = 'number';
    const article = /^[aeiou]/i.test(type) ? 'An' : 'A';
    expect(article).toBe('A');
  });
});

// ----- Shared Fields tests -----

describe('Shared Fields', () => {
  const runtime: AxCodeRuntime = {
    getUsageInstructions: () => '',
    createSession(globals) {
      return {
        execute: async (code: string) => {
          if (globals?.final && code.includes('final(')) {
            (globals.final as (...args: unknown[]) => void)('done');
            return 'done';
          }
          return 'ok';
        },
        close: () => {},
      };
    },
  };

  it('should throw when sharedField is not in signature input fields', () => {
    expect(
      () =>
        new AxAgent(
          { signature: 'query:string -> answer:string' },
          { contextFields: [], sharedFields: ['nonExistent'], runtime }
        )
    ).toThrow(/sharedField "nonExistent" not found in signature input fields/);
  });

  it('should exclude shared-only fields from Actor and Responder signatures', () => {
    const parentAgent = agent(
      'query:string, userId:string, context:string -> answer:string',
      {
        contextFields: ['context'],
        sharedFields: ['userId'],
        runtime,
      }
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actorSig = (parentAgent as any).actorProgram.getSignature();
    const actorInputNames = actorSig
      .getInputFields()
      .map((f: { name: string }) => f.name);

    // userId should NOT appear in Actor inputs (it's shared, bypasses LLM)
    expect(actorInputNames).not.toContain('userId');
    // query should still appear (it's a regular input)
    expect(actorInputNames).toContain('query');
    // context should NOT appear (it's a context field)
    expect(actorInputNames).not.toContain('context');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const responderSig = (parentAgent as any).responderProgram.getSignature();
    const responderInputNames = responderSig
      .getInputFields()
      .map((f: { name: string }) => f.name);

    expect(responderInputNames).not.toContain('userId');
    expect(responderInputNames).toContain('query');
  });

  it('should extend child agent signature with shared fields', () => {
    const childAgent = agent('question:string -> answer:string', {
      agentIdentity: { name: 'Child', description: 'A child agent' },
      contextFields: [],
      runtime,
    });

    // Before: child has only 'question' input
    const childInputsBefore = childAgent
      .getSignature()
      .getInputFields()
      .map((f) => f.name);
    expect(childInputsBefore).toEqual(['question']);

    // Create parent with sharedFields
    agent('query:string, userId:string -> answer:string', {
      agents: [childAgent],
      contextFields: [],
      sharedFields: ['userId'],
      runtime,
    });

    // After: child should have 'question' + 'userId'
    const childInputsAfter = childAgent
      .getSignature()
      .getInputFields()
      .map((f) => f.name);
    expect(childInputsAfter).toContain('question');
    expect(childInputsAfter).toContain('userId');
  });

  it('should auto-extend child contextFields for shared context fields', () => {
    const childAgent = agent('question:string -> answer:string', {
      agentIdentity: { name: 'Child', description: 'A child agent' },
      contextFields: [],
      runtime,
    });

    // Create parent where 'context' is both context and shared
    agent('query:string, context:string -> answer:string', {
      agents: [childAgent],
      contextFields: ['context'],
      sharedFields: ['context'],
      runtime,
    });

    // Child should now have 'context' in its contextFields
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const childContextFields = (childAgent as any).rlmConfig.contextFields;
    expect(childContextFields).toContain('context');

    // Child signature should include 'context'
    const childInputs = childAgent
      .getSignature()
      .getInputFields()
      .map((f) => f.name);
    expect(childInputs).toContain('context');
  });

  it('should respect child excludeSharedFields', () => {
    const childAgent = agent('question:string -> answer:string', {
      agentIdentity: { name: 'Child', description: 'A child agent' },
      contextFields: [],
      excludeSharedFields: ['userId'],
      runtime,
    });

    // Create parent with shared userId
    agent('query:string, userId:string -> answer:string', {
      agents: [childAgent],
      contextFields: [],
      sharedFields: ['userId'],
      runtime,
    });

    // Child should NOT have 'userId' (it excluded it)
    const childInputs = childAgent
      .getSignature()
      .getInputFields()
      .map((f) => f.name);
    expect(childInputs).not.toContain('userId');
  });

  it('should not duplicate fields already in child signature', () => {
    const childAgent = agent(
      'question:string, userId:string -> answer:string',
      {
        agentIdentity: { name: 'Child', description: 'A child agent' },
        contextFields: [],
        runtime,
      }
    );

    // Create parent that shares 'userId' which child already has
    agent('query:string, userId:string -> answer:string', {
      agents: [childAgent],
      contextFields: [],
      sharedFields: ['userId'],
      runtime,
    });

    // Child should still have exactly one 'userId'
    const childInputs = childAgent
      .getSignature()
      .getInputFields()
      .filter((f) => f.name === 'userId');
    expect(childInputs).toHaveLength(1);
  });

  it('should inject shared field values into subagent calls at runtime', async () => {
    let capturedChildArgs: Record<string, unknown> | undefined;

    const childAgent = agent('question:string -> answer:string', {
      agentIdentity: { name: 'Child', description: 'A child agent' },
      contextFields: [],
      runtime,
    });

    // Spy on getFunction to capture args passed to the child
    const originalGetFunction = childAgent.getFunction.bind(childAgent);
    childAgent.getFunction = () => {
      const fn = originalGetFunction();
      fn.func = async (args: any) => {
        capturedChildArgs = args;
        return 'Child Answer: mocked';
      };
      return fn;
    };

    let actorTurn = 0;
    const childCallRuntime: AxCodeRuntime = {
      getUsageInstructions: () => '',
      createSession(globals) {
        return {
          execute: async (code: string) => {
            // Check agents.child BEFORE final() since a code string might contain both
            if (code.includes('agents.child')) {
              const agentsObj = globals!.agents as Record<
                string,
                (...args: unknown[]) => Promise<unknown>
              >;
              const result = await agentsObj.child({ question: 'test' });
              return String(result);
            }
            if (code.includes('final(')) {
              (globals!.final as (...args: unknown[]) => void)('done');
              return 'done';
            }
            return 'ok';
          },
          close: () => {},
        };
      },
    };

    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');
        if (systemPrompt.includes('Code Generation Agent')) {
          actorTurn++;
          if (actorTurn === 1) {
            return {
              results: [
                {
                  index: 0,
                  content:
                    'Javascript Code: const r = await agents.child({ question: "test" })',
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

    const parentAgent = agent('query:string, userId:string -> answer:string', {
      agents: [childAgent],
      contextFields: [],
      sharedFields: ['userId'],
      runtime: childCallRuntime,
    });

    await parentAgent.forward(testMockAI, {
      query: 'test query',
      userId: 'user-123',
    });

    // The child should have received userId via shared field injection
    expect(capturedChildArgs).toBeDefined();
    expect(capturedChildArgs!.userId).toBe('user-123');
    expect(capturedChildArgs!.question).toBe('test');
  });

  it('should handle field in both contextFields and sharedFields', () => {
    const childAgent = agent('question:string -> answer:string', {
      agentIdentity: { name: 'Child', description: 'A child agent' },
      contextFields: [],
      runtime,
    });

    const parentAgent = agent('query:string, context:string -> answer:string', {
      agents: [childAgent],
      contextFields: ['context'],
      sharedFields: ['context'],
      runtime,
    });

    // Parent's Actor should not include 'context' (it's a context field)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actorInputs = (parentAgent as any).actorProgram
      .getSignature()
      .getInputFields()
      .map((f: { name: string }) => f.name);
    expect(actorInputs).not.toContain('context');

    // Child should have 'context' in signature AND contextFields
    const childInputs = childAgent
      .getSignature()
      .getInputFields()
      .map((f) => f.name);
    expect(childInputs).toContain('context');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const childContextFields = (childAgent as any).rlmConfig.contextFields;
    expect(childContextFields).toContain('context');
  });
});

// ----- getFunction() parameter schema tests -----

describe('getFunction() parameter schema', () => {
  const runtime: AxCodeRuntime = {
    getUsageInstructions: () => '',
    createSession() {
      return { execute: async () => 'ok', close: () => {} };
    },
  };

  it('should not include output fields in parameters', () => {
    const a = agent(
      'question:string, topic:string -> answer:string, reasoning:string',
      {
        agentIdentity: { name: 'Tester', description: 'A test agent' },
        contextFields: [],
        runtime,
      }
    );
    const params = a.getFunction().parameters!;
    // Input fields present
    expect(params.properties?.question).toBeDefined();
    expect(params.properties?.topic).toBeDefined();
    // Output fields absent
    expect(params.properties?.answer).toBeUndefined();
    expect(params.properties?.reasoning).toBeUndefined();
  });

  it('should not include parent-injected shared fields in parameters', () => {
    const childAgent = agent('question:string -> answer:string', {
      agentIdentity: { name: 'Child', description: 'A child agent' },
      contextFields: [],
      runtime,
    });

    // Before parent registers it — only own input fields
    const paramsBefore = childAgent.getFunction().parameters!;
    expect(Object.keys(paramsBefore.properties ?? {})).toEqual(['question']);

    // Create parent that injects 'userId' as a shared field
    agent('query:string, userId:string -> answer:string', {
      agents: [childAgent],
      contextFields: [],
      sharedFields: ['userId'],
      runtime,
    });

    // After parent registration — shared field must NOT appear in parameters
    const paramsAfter = childAgent.getFunction().parameters!;
    expect(paramsAfter.properties?.question).toBeDefined();
    expect(paramsAfter.properties?.userId).toBeUndefined();
    expect(paramsAfter.required).not.toContain('userId');
  });

  it('should keep fields already in child signature when parent shares the same name', () => {
    // Child already owns 'userId' — parent sharing it is a no-op in _extendForSharedFields
    const childAgent = agent(
      'question:string, userId:string -> answer:string',
      {
        agentIdentity: { name: 'Child', description: 'A child agent' },
        contextFields: [],
        runtime,
      }
    );

    agent('query:string, userId:string -> answer:string', {
      agents: [childAgent],
      contextFields: [],
      sharedFields: ['userId'],
      runtime,
    });

    // userId was not injected (child already had it) so it remains in parameters
    const params = childAgent.getFunction().parameters!;
    expect(params.properties?.userId).toBeDefined();
  });

  it('should not include excluded shared fields', () => {
    const childAgent = agent('question:string -> answer:string', {
      agentIdentity: { name: 'Child', description: 'A child agent' },
      contextFields: [],
      excludeSharedFields: ['userId'],
      runtime,
    });

    agent('query:string, userId:string -> answer:string', {
      agents: [childAgent],
      contextFields: [],
      sharedFields: ['userId'],
      runtime,
    });

    // userId was excluded — not extended into child, not in parameters
    const params = childAgent.getFunction().parameters!;
    expect(params.properties?.userId).toBeUndefined();
  });

  it('should handle multiple shared fields — only own fields remain in parameters', () => {
    const childAgent = agent('question:string -> answer:string', {
      agentIdentity: { name: 'Child', description: 'A child agent' },
      contextFields: [],
      runtime,
    });

    agent('query:string, userId:string, sessionId:string -> answer:string', {
      agents: [childAgent],
      contextFields: [],
      sharedFields: ['userId', 'sessionId'],
      runtime,
    });

    const params = childAgent.getFunction().parameters!;
    // Own fields present
    expect(params.properties?.question).toBeDefined();
    // Both injected shared fields absent
    expect(params.properties?.userId).toBeUndefined();
    expect(params.properties?.sessionId).toBeUndefined();
  });
});

// ----- axBuildActorDefinition agents & functions section tests -----

describe('axBuildActorDefinition - Available Sub-Agents and Tool Functions', () => {
  const runtime: AxCodeRuntime = {
    getUsageInstructions: () => '',
    createSession() {
      return { execute: async () => 'ok', close: () => {} };
    },
  };

  const sampleSchema: AxFunctionJSONSchema = {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query' },
      limit: { type: 'number', description: 'Max results' },
    },
    required: ['query'],
  };

  it('should render ### Available Sub-Agents section when agents are provided', () => {
    const result = axBuildActorDefinition(undefined, [], [], {
      agents: [
        {
          name: 'searchAgent',
          description: 'Searches the web',
          parameters: sampleSchema,
        },
      ],
    });
    expect(result).toContain('### Available Sub-Agents');
    expect(result).toContain('await agents.searchAgent(');
    expect(result).toContain('Searches the web');
  });

  it('should render required params without ? and optional params with ?', () => {
    const result = axBuildActorDefinition(undefined, [], [], {
      agents: [
        {
          name: 'searchAgent',
          description: 'desc',
          parameters: sampleSchema,
        },
      ],
    });
    expect(result).toContain('query: string'); // required — no ?
    expect(result).toContain('limit?: number'); // optional — has ?
  });

  it('should render ### Available Tool Functions section when functions are provided', () => {
    const result = axBuildActorDefinition(undefined, [], [], {
      functions: [
        {
          name: 'fetchData',
          description: 'Fetches remote data',
          parameters: sampleSchema,
        },
      ],
    });
    expect(result).toContain('### Available Tool Functions');
    expect(result).toContain('await fetchData(');
    expect(result).toContain('Fetches remote data');
  });

  it('should omit sub-agents section when agents array is empty', () => {
    const result = axBuildActorDefinition(undefined, [], [], { agents: [] });
    expect(result).not.toContain('### Available Sub-Agents');
  });

  it('should omit functions section when functions array is empty', () => {
    const result = axBuildActorDefinition(undefined, [], [], { functions: [] });
    expect(result).not.toContain('### Available Tool Functions');
  });

  it('should omit both sections when neither option is provided', () => {
    const result = axBuildActorDefinition(undefined, [], [], {});
    expect(result).not.toContain('### Available Sub-Agents');
    expect(result).not.toContain('### Available Tool Functions');
  });

  it('should render {} for agent with undefined parameters', () => {
    const result = axBuildActorDefinition(undefined, [], [], {
      agents: [
        { name: 'noParamsAgent', description: 'desc', parameters: undefined },
      ],
    });
    expect(result).toContain('await agents.noParamsAgent({})');
  });

  it('should render {} for agent with empty properties', () => {
    const result = axBuildActorDefinition(undefined, [], [], {
      agents: [
        {
          name: 'emptyAgent',
          description: 'desc',
          parameters: { type: 'object', properties: {} },
        },
      ],
    });
    expect(result).toContain('await agents.emptyAgent({})');
  });

  it('should render multiple agents', () => {
    const result = axBuildActorDefinition(undefined, [], [], {
      agents: [
        {
          name: 'agentOne',
          description: 'First agent',
          parameters: sampleSchema,
        },
        { name: 'agentTwo', description: 'Second agent' },
      ],
    });
    expect(result).toContain('await agents.agentOne(');
    expect(result).toContain('First agent');
    expect(result).toContain('await agents.agentTwo(');
    expect(result).toContain('Second agent');
  });

  it('should render array type params correctly', () => {
    const arraySchema: AxFunctionJSONSchema = {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of IDs',
        },
      },
      required: ['ids'],
    };
    const result = axBuildActorDefinition(undefined, [], [], {
      functions: [
        { name: 'batchFetch', description: 'desc', parameters: arraySchema },
      ],
    });
    expect(result).toContain('ids: string[]');
  });

  it('should render enum type params correctly', () => {
    const enumSchema: AxFunctionJSONSchema = {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['fast', 'slow'], description: 'Mode' },
      },
      required: ['mode'],
    };
    const result = axBuildActorDefinition(undefined, [], [], {
      agents: [
        { name: 'modeAgent', description: 'desc', parameters: enumSchema },
      ],
    });
    expect(result).toContain('"fast" | "slow"');
  });

  it('actor program description should include sub-agent descriptions end-to-end', () => {
    const childAgent = agent('question:string -> answer:string', {
      agentIdentity: {
        name: 'Physics Researcher',
        description: 'Answers physics questions',
      },
      contextFields: [],
      runtime,
    });

    const parentAgent = agent('query:string -> finalAnswer:string', {
      agents: [childAgent],
      contextFields: [],
      runtime,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actorDescription = (parentAgent as any).actorProgram
      .getSignature()
      .getDescription();

    expect(actorDescription).toContain('### Available Sub-Agents');
    expect(actorDescription).toContain('await agents.physicsResearcher(');
    expect(actorDescription).toContain('Answers physics questions');
    expect(actorDescription).toContain('question: string');
  });

  it('actor program description should include tool function descriptions end-to-end', () => {
    const parentAgent = agent('query:string -> finalAnswer:string', {
      functions: [
        {
          name: 'lookupData',
          description: 'Looks up data in the database',
          parameters: sampleSchema,
          func: async () => 'result',
        },
      ],
      contextFields: [],
      runtime,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actorDescription = (parentAgent as any).actorProgram
      .getSignature()
      .getDescription();

    expect(actorDescription).toContain('### Available Tool Functions');
    expect(actorDescription).toContain('await lookupData(');
    expect(actorDescription).toContain('Looks up data in the database');
  });
});
