import { describe, expect, it } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import type { AxFunction, AxFunctionJSONSchema } from '../ai/types.js';
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

  it('should include object-configured context field as optional Actor input', () => {
    const testAgent = agent('context:string, query:string -> answer:string', {
      contextFields: [{ field: 'context', promptMaxChars: 1200 }],
      runtime,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actorSig = (testAgent as any).actorProgram.getSignature();
    const inputs = actorSig.getInputFields();
    const contextField = inputs.find((f: AxIField) => f.name === 'context');

    expect(contextField).toBeDefined();
    expect(contextField?.isOptional).toBe(true);
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

// ----- Context field runtime access and prompt inlining -----

describe('Context field runtime access and prompt inlining', () => {
  const makeMock = (onActorPrompt?: (prompt: string) => void) =>
    new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');
        const userPrompt = String(req.chatPrompt[1]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          onActorPrompt?.(userPrompt);
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
              { index: 0, content: 'Answer: ok', finishReason: 'stop' },
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

  it('should expose all inputs via inputs.<field> and keep non-colliding top-level aliases', async () => {
    let capturedGlobals: Record<string, unknown> | undefined;

    const runtime: AxCodeRuntime = {
      getUsageInstructions: () => '',
      createSession(globals) {
        capturedGlobals = globals;
        return {
          execute: async (code: string) => {
            if (code.includes('final(') && globals?.final) {
              (globals.final as (...args: unknown[]) => void)('done');
            }
            return 'ok';
          },
          close: () => {},
        };
      },
    };

    const testMockAI = makeMock();
    const testAgent = agent('context:string, query:string -> answer:string', {
      ai: testMockAI,
      contextFields: ['context'],
      runtime,
    });

    await testAgent.forward(testMockAI, {
      context: 'ctx',
      query: 'what is this',
    });

    expect((capturedGlobals?.inputs as Record<string, unknown>)?.context).toBe(
      'ctx'
    );
    expect((capturedGlobals?.inputs as Record<string, unknown>)?.query).toBe(
      'what is this'
    );
    expect(capturedGlobals?.context).toBe('ctx');
    expect(capturedGlobals?.query).toBe('what is this');
  });

  it('should preserve reserved top-level names while keeping colliding inputs under inputs.<field>', async () => {
    let capturedGlobals: Record<string, unknown> | undefined;

    const runtime: AxCodeRuntime = {
      getUsageInstructions: () => '',
      createSession(globals) {
        capturedGlobals = globals;
        return {
          execute: async (code: string) => {
            if (code.includes('final(') && globals?.final) {
              (globals.final as (...args: unknown[]) => void)('done');
            }
            return 'ok';
          },
          close: () => {},
        };
      },
    };

    const testMockAI = makeMock();
    const testAgent = agent('final:string, query:string -> answer:string', {
      ai: testMockAI,
      contextFields: [],
      runtime,
    });

    await testAgent.forward(testMockAI, {
      final: 'user-final-value',
      query: 'question',
    });

    expect(typeof capturedGlobals?.final).toBe('function');
    expect((capturedGlobals?.inputs as Record<string, unknown>)?.final).toBe(
      'user-final-value'
    );
    expect(capturedGlobals?.query).toBe('question');
  });

  it('should inline small object-configured context values into Actor prompt', async () => {
    let actorPrompt = '';

    const runtime: AxCodeRuntime = {
      getUsageInstructions: () => '',
      createSession(globals) {
        return {
          execute: async (code: string) => {
            if (code.includes('final(') && globals?.final) {
              (globals.final as (...args: unknown[]) => void)('done');
            }
            return 'ok';
          },
          close: () => {},
        };
      },
    };

    const testMockAI = makeMock((prompt) => {
      actorPrompt = prompt;
    });
    const testAgent = agent('context:string, query:string -> answer:string', {
      ai: testMockAI,
      contextFields: [{ field: 'context', promptMaxChars: 20 }],
      runtime,
    });

    const token = 'INLINE_TOKEN_123';
    await testAgent.forward(testMockAI, {
      context: token,
      query: 'question',
    });

    expect(actorPrompt).toContain(token);
    expect(actorPrompt).toContain('prompt=inline (<=20 chars)');
  });

  it('should not inline large object-configured context values into Actor prompt', async () => {
    let actorPrompt = '';

    const runtime: AxCodeRuntime = {
      getUsageInstructions: () => '',
      createSession(globals) {
        return {
          execute: async (code: string) => {
            if (code.includes('final(') && globals?.final) {
              (globals.final as (...args: unknown[]) => void)('done');
            }
            return 'ok';
          },
          close: () => {},
        };
      },
    };

    const testMockAI = makeMock((prompt) => {
      actorPrompt = prompt;
    });
    const testAgent = agent('context:string, query:string -> answer:string', {
      ai: testMockAI,
      contextFields: [{ field: 'context', promptMaxChars: 10 }],
      runtime,
    });

    const token = 'LARGE_CONTEXT_TOKEN_abcdefghijklmnopqrstuvwxyz';
    await testAgent.forward(testMockAI, {
      context: token,
      query: 'question',
    });

    expect(actorPrompt).not.toContain(token);
    expect(actorPrompt).toContain('prompt=runtime-only (>10 chars)');
  });

  it('should keep string-form context fields runtime-only in Actor prompt', async () => {
    let actorPrompt = '';

    const runtime: AxCodeRuntime = {
      getUsageInstructions: () => '',
      createSession(globals) {
        return {
          execute: async (code: string) => {
            if (code.includes('final(') && globals?.final) {
              (globals.final as (...args: unknown[]) => void)('done');
            }
            return 'ok';
          },
          close: () => {},
        };
      },
    };

    const testMockAI = makeMock((prompt) => {
      actorPrompt = prompt;
    });
    const testAgent = agent('context:string, query:string -> answer:string', {
      ai: testMockAI,
      contextFields: ['context'],
      runtime,
    });

    const token = 'STRING_FORM_CONTEXT_TOKEN';
    await testAgent.forward(testMockAI, {
      context: token,
      query: 'question',
    });

    expect(actorPrompt).not.toContain(token);
    expect(actorPrompt).toContain('prompt=runtime-only');
  });

  it('should validate object-form context field configuration', () => {
    const runtime: AxCodeRuntime = {
      getUsageInstructions: () => '',
      createSession() {
        return { execute: async () => 'ok', close: () => {} };
      },
    };

    expect(() =>
      agent('context:string, query:string -> answer:string', {
        contextFields: [{ field: 'missingField', promptMaxChars: 1200 }],
        runtime,
      })
    ).toThrow(/RLM contextField "missingField" not found in signature/);

    expect(() =>
      agent('context:string, query:string -> answer:string', {
        contextFields: ['context', { field: 'context' }],
        runtime,
      })
    ).toThrow(/Duplicate contextField "context"/);

    expect(() =>
      agent('context:string, query:string -> answer:string', {
        contextFields: [{ field: 'context', promptMaxChars: -1 }],
        runtime,
      })
    ).toThrow(
      /contextField "context" promptMaxChars must be a finite number >= 0/
    );
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

  it('should throw when a required context field is missing at runtime', async () => {
    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async () => ({
        results: [{ index: 0, content: 'fallback', finishReason: 'stop' }],
        modelUsage: makeModelUsage(),
      }),
    });

    const testAgent = agent('context:string, query:string -> answer:string', {
      ai: testMockAI,
      contextFields: ['context'],
      runtime: defaultRuntime,
    });

    await expect(
      testAgent.forward(testMockAI, { query: 'missing context' } as any)
    ).rejects.toThrow(
      'RLM contextField "context" is missing from input values'
    );
  });

  it('should treat undefined required context field as missing at runtime', async () => {
    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async () => ({
        results: [{ index: 0, content: 'fallback', finishReason: 'stop' }],
        modelUsage: makeModelUsage(),
      }),
    });

    const testAgent = agent('context:string, query:string -> answer:string', {
      ai: testMockAI,
      contextFields: ['context'],
      runtime: defaultRuntime,
    });

    await expect(
      testAgent.forward(testMockAI, {
        query: 'test',
        context: undefined,
      } as any)
    ).rejects.toThrow(
      'RLM contextField "context" is missing from input values'
    );
  });

  it('should allow missing optional context fields at runtime', async () => {
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

    const testAgent = agent('context?:string, query:string -> answer:string', {
      ai: testMockAI,
      contextFields: ['context'],
      runtime: defaultRuntime,
    });

    const result = await testAgent.forward(testMockAI, {
      query: 'no context provided',
    });

    expect(result.answer).toBe('done');
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

  it('should execute inspect_runtime at runtime and pass reserved names', async () => {
    let inspectExecuted = false;
    let inspectReservedNames: readonly string[] | undefined;
    let responderPrompt = '';

    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');
        const userPrompt = String(req.chatPrompt[1]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          return {
            results: [
              {
                index: 0,
                content: 'Javascript Code: INSPECT_TEST',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }

        if (systemPrompt.includes('Answer Synthesis Agent')) {
          responderPrompt = userPrompt;
          return {
            results: [
              { index: 0, content: 'Answer: inspected', finishReason: 'stop' },
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
          execute: async (
            code: string,
            opts?: { signal?: AbortSignal; reservedNames?: readonly string[] }
          ) => {
            if (code === 'INSPECT_TEST') {
              const inspectRuntime = globals?.inspect_runtime as
                | (() => Promise<string>)
                | undefined;
              if (!inspectRuntime) {
                throw new Error('inspect_runtime missing');
              }

              const snapshot = await inspectRuntime();
              if (globals?.final) {
                (globals.final as (...args: unknown[]) => void)(snapshot);
              }
              return snapshot;
            }

            if (code.includes('Object.entries(globalThis)')) {
              inspectExecuted = true;
              inspectReservedNames = opts?.reservedNames;
              return 'stateVar: number = 7';
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
      contextManagement: { stateInspection: { contextThreshold: 500 } },
    });

    const result = await testAgent.forward(testMockAI, {
      context: 'ctx',
      query: 'q',
    });

    expect(result.answer).toBe('inspected');
    expect(inspectExecuted).toBe(true);
    expect(inspectReservedNames).toBeDefined();
    expect(inspectReservedNames).toContain('inputs');
    expect(inspectReservedNames).toContain('inspect_runtime');
    expect(inspectReservedNames).toContain('context');
    expect(inspectReservedNames).toContain('query');
    expect(responderPrompt).toContain('stateVar: number = 7');
  });

  it('should not reserve top-level input aliases during normal code execution', async () => {
    let executionReservedNames: readonly string[] | undefined;

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
                  'Javascript Code: const context = inputs.context; final(context)',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }

        if (systemPrompt.includes('Answer Synthesis Agent')) {
          return {
            results: [
              { index: 0, content: 'Answer: ok', finishReason: 'stop' },
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
          execute: async (
            code: string,
            opts?: { signal?: AbortSignal; reservedNames?: readonly string[] }
          ) => {
            executionReservedNames = opts?.reservedNames;
            if (code.includes('final(') && globals?.final) {
              (globals.final as (...args: unknown[]) => void)('ok');
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
    });

    const result = await testAgent.forward(testMockAI, {
      context: 'ctx',
      query: 'q',
    });

    expect(result.answer).toBe('ok');
    expect(executionReservedNames).toBeDefined();
    expect(executionReservedNames).toContain('inputs');
    expect(executionReservedNames).not.toContain('context');
    expect(executionReservedNames).not.toContain('query');
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
            if ((globals?.utils as any)?.myTool && code.includes('myTool')) {
              const toolFn = (globals!.utils as any).myTool as (
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
      functions: {
        local: [
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
      },
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
    expect(result).toContain('- `query` -> `inputs.query` (string, required)');
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
    expect(result).toContain(
      "- `query` -> `inputs.query` (string, required): The user's search query"
    );
  });

  it('should mark optional context fields in runtime mapping', () => {
    const fields: AxIField[] = [
      {
        name: 'query',
        title: 'Query',
        type: { name: 'string' },
        isOptional: true,
      },
    ];
    const result = axBuildActorDefinition(
      undefined,
      fields,
      [{ name: 'answer', title: 'Answer', type: { name: 'string' } }],
      {}
    );
    expect(result).toContain('- `query` -> `inputs.query` (string, optional)');
  });

  it('should document final()/ask_clarification() exit signals', () => {
    const result = axBuildActorDefinition(undefined, [], [], {});
    expect(result).toContain('final(...args)');
    expect(result).toContain('ask_clarification(...args)');
  });

  it('should document llmQuery API', () => {
    const result = axBuildActorDefinition(undefined, [], [], {});
    expect(result).toContain(
      'await llmQuery(query:string, context?:any) : string'
    );
    expect(result).toContain(
      'await llmQuery({ query:string, context?:any }) : string'
    );
    expect(result).toContain('await llmQuery([{');
    expect(result).toContain(']) : string[]');
  });

  it('should document canonical runtime input access', () => {
    const result = axBuildActorDefinition(undefined, [], [], {});
    expect(result).toContain(
      'In JavaScript code, context fields map to `inputs.<fieldName>` as follows:'
    );
    expect(result).not.toContain('### Pre-loaded context variables');
    expect(result).toContain('### Runtime Field Access');
  });

  it('should document scoped function call contract rules', () => {
    const result = axBuildActorDefinition(undefined, [], [], {});
    expect(result).toContain(
      'Use `await agents.<name>({...})` and `await <namespace>.<fnName>({...})` with a single object argument.'
    );
    expect(result).toContain(
      '`llmQuery` supports positional (`llmQuery(query, context?)`), single-object (`llmQuery({ query, context })`), and batched (`llmQuery([{ query, context }, ...])`) forms.'
    );
    expect(result).toContain(
      '`final(...args)` and `ask_clarification(...args)` are completion signals; do not use `await`.'
    );
    expect(result).not.toContain('Use exact namespace-qualified names.');
  });

  it('should not include contradictory legacy guidance', () => {
    const result = axBuildActorDefinition(undefined, [], [], {});
    expect(result).not.toContain('Pass a single object argument.');
    expect(result).not.toContain(
      'Do not use `final` in the a code snippet that also contains `console.log`  statements.'
    );
  });

  it('should keep batched llmQuery docs concise when maxSubAgentCalls is configured', () => {
    const result = axBuildActorDefinition(undefined, [], [], {
      maxSubAgentCalls: 7,
    });
    expect(result).toContain(
      '- `await llmQuery([{ query:string, context?:any }, ...]) : string[]` — Batched parallel form.'
    );
    expect(result).toContain('Sub-agent call budget: 7.');
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
    expect(result).toContain('- `documents` (string, required)');
  });

  it('should mark optional context variable metadata', () => {
    const fields: AxIField[] = [
      {
        name: 'documents',
        title: 'Documents',
        type: { name: 'string' },
        isOptional: true,
      },
    ];
    const result = axBuildResponderDefinition(undefined, fields);
    expect(result).toContain('- `documents` (string, optional)');
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
  it('should enforce maxSubAgentCalls budget in runtime', async () => {
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
                  content: 'Javascript Code: BUDGET_TEST',
                  finishReason: 'stop',
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }
          if (userPrompt.includes('Task: one')) {
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: final("one")',
                  finishReason: 'stop',
                },
              ],
              modelUsage: makeModelUsage(),
            };
          }
          if (userPrompt.includes('Task: two')) {
            return {
              results: [
                {
                  index: 0,
                  content: 'Javascript Code: final("two")',
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

    let budgetResult: string[] = [];
    const runtime: AxCodeRuntime = {
      getUsageInstructions: () => '',
      createSession(globals) {
        return {
          execute: async (code: string) => {
            if (code === 'BUDGET_TEST') {
              const llmQueryFn = globals?.llmQuery as (
                query: string,
                context?: string
              ) => Promise<string>;
              const r1 = await llmQueryFn('one', 'ctx1');
              const r2 = await llmQueryFn('two', 'ctx2');
              budgetResult = [r1, r2];
              return JSON.stringify(budgetResult);
            }

            if (globals?.final && code.includes('final(')) {
              (globals.final as (...args: unknown[]) => void)('done');
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
      maxSubAgentCalls: 1,
      mode: 'advanced',
    });

    await testAgent.forward(testMockAI, {
      context: 'unused',
      query: 'unused',
    });

    expect(budgetResult[0]).not.toContain('Sub-query budget exhausted');
    expect(budgetResult[1]).toContain('Sub-query budget exhausted (1/1)');
  });

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
              const utilsNs = globals?.utils as
                | Record<string, unknown>
                | undefined;
              if (utilsNs?.myTool) {
                recursiveToolCalled = true;
                const myTool = utilsNs.myTool as (
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
      functions: {
        local: [
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
      },
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
          { contextFields: [], fields: { shared: ['nonExistent'] }, runtime }
        )
    ).toThrow(/sharedField "nonExistent" not found in signature input fields/);
  });

  it('should exclude shared-only fields from Actor and Responder signatures', () => {
    const parentAgent = agent(
      'query:string, userId:string, context:string -> answer:string',
      {
        contextFields: ['context'],
        fields: { shared: ['userId'] },
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
      agents: { local: [childAgent] },
      contextFields: [],
      fields: { shared: ['userId'] },
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
      agents: { local: [childAgent] },
      contextFields: ['context'],
      fields: { shared: ['context'] },
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
      fields: { excluded: ['userId'] },
      runtime,
    });

    // Create parent with shared userId
    agent('query:string, userId:string -> answer:string', {
      agents: { local: [childAgent] },
      contextFields: [],
      fields: { shared: ['userId'] },
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
      agents: { local: [childAgent] },
      contextFields: [],
      fields: { shared: ['userId'] },
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
      agents: { local: [childAgent] },
      contextFields: [],
      fields: { shared: ['userId'] },
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
      agents: { local: [childAgent] },
      contextFields: ['context'],
      fields: { shared: ['context'] },
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

// ----- Shared Agents tests -----

describe('Shared Agents', () => {
  const runtime: AxCodeRuntime = {
    getUsageInstructions: () => '',
    createSession() {
      return { execute: async () => 'ok', close: () => {} };
    },
  };

  it('should add sharedAgents to direct child agents', () => {
    const utilityAgent = agent('taskInput:string -> taskOutput:string', {
      agentIdentity: { name: 'Utility', description: 'A utility agent' },
      contextFields: [],
      runtime,
    });

    const childAgent = agent('question:string -> answer:string', {
      agentIdentity: { name: 'Child', description: 'A child agent' },
      contextFields: [],
      runtime,
    });

    agent('query:string -> finalAnswer:string', {
      agents: { local: [childAgent], shared: [utilityAgent] },
      contextFields: [],
      runtime,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const childAgents = (childAgent as any).agents as any[];
    const childAgentNames = childAgents.map((a: any) => a.getFunction().name);
    expect(childAgentNames).toContain('utility');
  });

  it('should NOT propagate sharedAgents to grandchild agents', () => {
    const utilityAgent = agent('taskInput:string -> taskOutput:string', {
      agentIdentity: { name: 'Utility', description: 'A utility agent' },
      contextFields: [],
      runtime,
    });

    const grandchild = agent('question:string -> answer:string', {
      agentIdentity: { name: 'Grandchild', description: 'A grandchild' },
      contextFields: [],
      runtime,
    });

    const child = agent('topic:string -> summary:string', {
      agentIdentity: { name: 'Child', description: 'A child agent' },
      agents: { local: [grandchild] },
      contextFields: [],
      runtime,
    });

    agent('query:string -> finalAnswer:string', {
      agents: { local: [child], shared: [utilityAgent] },
      contextFields: [],
      runtime,
    });

    // Child should have the utility agent
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const childAgents = (child as any).agents as any[];
    const childAgentNames = childAgents.map((a: any) => a.getFunction().name);
    expect(childAgentNames).toContain('utility');

    // Grandchild should NOT have the utility agent
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const grandchildAgents = (grandchild as any).agents;
    expect(grandchildAgents).toBeUndefined();
  });

  it('should avoid duplicate agents when child already has the agent', () => {
    const utilityAgent = agent('taskInput:string -> taskOutput:string', {
      agentIdentity: { name: 'Utility', description: 'A utility agent' },
      contextFields: [],
      runtime,
    });

    const childAgent = agent('question:string -> answer:string', {
      agentIdentity: { name: 'Child', description: 'A child agent' },
      agents: { local: [utilityAgent] },
      contextFields: [],
      runtime,
    });

    agent('query:string -> finalAnswer:string', {
      agents: { local: [childAgent], shared: [utilityAgent] },
      contextFields: [],
      runtime,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const childAgents = (childAgent as any).agents as any[];
    const utilityCount = childAgents.filter(
      (a: any) => a.getFunction().name === 'utility'
    ).length;
    expect(utilityCount).toBe(1);
  });

  it('should not add a child agent to itself when listed in shared (self-registration)', () => {
    const childAgent = agent('question:string -> answer:string', {
      agentIdentity: { name: 'Child', description: 'A child agent' },
      contextFields: [],
      runtime,
    });

    agent('query:string -> finalAnswer:string', {
      agents: { local: [childAgent], shared: [childAgent] },
      contextFields: [],
      runtime,
    });

    // childAgent's own agents list must not contain itself
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const childAgents = (childAgent as any).agents as any[] | undefined;
    const selfRefs = (childAgents ?? []).filter((a: any) => a === childAgent);
    expect(selfRefs).toHaveLength(0);
  });
});

// ----- Global Shared Agents tests -----

describe('Global Shared Agents', () => {
  const runtime: AxCodeRuntime = {
    getUsageInstructions: () => '',
    createSession() {
      return { execute: async () => 'ok', close: () => {} };
    },
  };

  it('should add globalSharedAgents to all descendants', () => {
    const utilityAgent = agent('taskInput:string -> taskOutput:string', {
      agentIdentity: { name: 'Utility', description: 'A utility agent' },
      contextFields: [],
      runtime,
    });

    const grandchild = agent('question:string -> answer:string', {
      agentIdentity: { name: 'Grandchild', description: 'A grandchild' },
      contextFields: [],
      runtime,
    });

    const child = agent('topic:string -> summary:string', {
      agentIdentity: { name: 'Child', description: 'A child agent' },
      agents: { local: [grandchild] },
      contextFields: [],
      runtime,
    });

    agent('query:string -> finalAnswer:string', {
      agents: { local: [child], globallyShared: [utilityAgent] },
      contextFields: [],
      runtime,
    });

    // Child should have the utility agent
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const childAgents = (child as any).agents as any[];
    const childAgentNames = childAgents.map((a: any) => a.getFunction().name);
    expect(childAgentNames).toContain('utility');

    // Grandchild should ALSO have the utility agent
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const grandchildAgents = (grandchild as any).agents as any[];
    const grandchildAgentNames = grandchildAgents.map(
      (a: any) => a.getFunction().name
    );
    expect(grandchildAgentNames).toContain('utility');
  });

  it('should avoid duplicates across the tree', () => {
    const utilityAgent = agent('taskInput:string -> taskOutput:string', {
      agentIdentity: { name: 'Utility', description: 'A utility agent' },
      contextFields: [],
      runtime,
    });

    const grandchild = agent('question:string -> answer:string', {
      agentIdentity: { name: 'Grandchild', description: 'A grandchild' },
      agents: { local: [utilityAgent] },
      contextFields: [],
      runtime,
    });

    const child = agent('topic:string -> summary:string', {
      agentIdentity: { name: 'Child', description: 'A child agent' },
      agents: { local: [grandchild] },
      contextFields: [],
      runtime,
    });

    agent('query:string -> finalAnswer:string', {
      agents: { local: [child], globallyShared: [utilityAgent] },
      contextFields: [],
      runtime,
    });

    // Grandchild already had utility; should not be duplicated
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const grandchildAgents = (grandchild as any).agents as any[];
    const utilityCount = grandchildAgents.filter(
      (a: any) => a.getFunction().name === 'utility'
    ).length;
    expect(utilityCount).toBe(1);
  });

  it('should not add a child agent to itself when listed in globallyShared (self-registration)', () => {
    const childAgent = agent('question:string -> answer:string', {
      agentIdentity: { name: 'Child', description: 'A child agent' },
      contextFields: [],
      runtime,
    });

    agent('query:string -> finalAnswer:string', {
      agents: { local: [childAgent], globallyShared: [childAgent] },
      contextFields: [],
      runtime,
    });

    // childAgent's own agents list must not contain itself
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const childAgents = (childAgent as any).agents as any[] | undefined;
    const selfRefs = (childAgents ?? []).filter((a: any) => a === childAgent);
    expect(selfRefs).toHaveLength(0);
  });
});

// ----- Global Shared Fields tests -----

describe('Global Shared Fields', () => {
  const runtime: AxCodeRuntime = {
    getUsageInstructions: () => '',
    createSession() {
      return { execute: async () => 'ok', close: () => {} };
    },
  };

  it('should throw when globalSharedField is not in signature input fields', () => {
    expect(
      () =>
        new AxAgent(
          { signature: 'query:string -> answer:string' },
          {
            contextFields: [],
            fields: { globallyShared: ['nonExistent'] },
            runtime,
          }
        )
    ).toThrow(
      /globalSharedField "nonExistent" not found in signature input fields/
    );
  });

  it('should exclude global shared fields from parent Actor and Responder', () => {
    const childAgent = agent('question:string -> answer:string', {
      agentIdentity: { name: 'Child', description: 'A child agent' },
      contextFields: [],
      runtime,
    });

    const parentAgent = agent('query:string, userId:string -> answer:string', {
      agents: { local: [childAgent] },
      contextFields: [],
      fields: { globallyShared: ['userId'] },
      runtime,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actorSig = (parentAgent as any).actorProgram.getSignature();
    const actorInputNames = actorSig
      .getInputFields()
      .map((f: { name: string }) => f.name);
    expect(actorInputNames).not.toContain('userId');
    expect(actorInputNames).toContain('query');
  });

  it('should extend all descendants signatures with globalSharedFields', () => {
    const grandchild = agent('question:string -> answer:string', {
      agentIdentity: { name: 'Grandchild', description: 'A grandchild' },
      contextFields: [],
      runtime,
    });

    const child = agent('topic:string -> summary:string', {
      agentIdentity: { name: 'Child', description: 'A child agent' },
      agents: { local: [grandchild] },
      contextFields: [],
      runtime,
    });

    agent('query:string, userId:string -> finalAnswer:string', {
      agents: { local: [child] },
      contextFields: [],
      fields: { globallyShared: ['userId'] },
      runtime,
    });

    // Child should have userId in its signature
    const childInputs = child
      .getSignature()
      .getInputFields()
      .map((f) => f.name);
    expect(childInputs).toContain('userId');

    // Grandchild should ALSO have userId in its signature
    const grandchildInputs = grandchild
      .getSignature()
      .getInputFields()
      .map((f) => f.name);
    expect(grandchildInputs).toContain('userId');
  });

  it('should strip globalSharedFields from all descendants getFunction().parameters', () => {
    const grandchild = agent('question:string -> answer:string', {
      agentIdentity: { name: 'Grandchild', description: 'A grandchild' },
      contextFields: [],
      runtime,
    });

    const child = agent('topic:string -> summary:string', {
      agentIdentity: { name: 'Child', description: 'A child agent' },
      agents: { local: [grandchild] },
      contextFields: [],
      runtime,
    });

    agent('query:string, userId:string -> finalAnswer:string', {
      agents: { local: [child] },
      contextFields: [],
      fields: { globallyShared: ['userId'] },
      runtime,
    });

    // Child: userId should NOT appear in getFunction().parameters
    const childParams = child.getFunction().parameters!;
    expect(childParams.properties?.userId).toBeUndefined();
    expect(childParams.properties?.topic).toBeDefined();

    // Grandchild: userId should NOT appear in getFunction().parameters
    const grandchildParams = grandchild.getFunction().parameters!;
    expect(grandchildParams.properties?.userId).toBeUndefined();
    expect(grandchildParams.properties?.question).toBeDefined();
  });

  it('should add globalSharedFields to intermediate agents sharedFieldNames for value chaining', () => {
    const grandchild = agent('question:string -> answer:string', {
      agentIdentity: { name: 'Grandchild', description: 'A grandchild' },
      contextFields: [],
      runtime,
    });

    const child = agent('topic:string -> summary:string', {
      agentIdentity: { name: 'Child', description: 'A child agent' },
      agents: { local: [grandchild] },
      contextFields: [],
      runtime,
    });

    agent('query:string, userId:string -> finalAnswer:string', {
      agents: { local: [child] },
      contextFields: [],
      fields: { globallyShared: ['userId'] },
      runtime,
    });

    // Child's sharedFieldNames should include 'userId' (for value chaining)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const childSharedFields = (child as any).sharedFieldNames as string[];
    expect(childSharedFields).toContain('userId');
  });

  it('should respect excludeSharedFields for globalSharedFields', () => {
    const grandchild = agent('question:string -> answer:string', {
      agentIdentity: { name: 'Grandchild', description: 'A grandchild' },
      contextFields: [],
      fields: { excluded: ['userId'] },
      runtime,
    });

    const child = agent('topic:string -> summary:string', {
      agentIdentity: { name: 'Child', description: 'A child agent' },
      agents: { local: [grandchild] },
      contextFields: [],
      runtime,
    });

    agent('query:string, userId:string -> finalAnswer:string', {
      agents: { local: [child] },
      contextFields: [],
      fields: { globallyShared: ['userId'] },
      runtime,
    });

    // Child should have userId
    const childInputs = child
      .getSignature()
      .getInputFields()
      .map((f) => f.name);
    expect(childInputs).toContain('userId');

    // Grandchild excluded it — should NOT have userId
    const grandchildInputs = grandchild
      .getSignature()
      .getInputFields()
      .map((f) => f.name);
    expect(grandchildInputs).not.toContain('userId');
  });

  it('should auto-extend contextFields for globalSharedFields that are context in parent', () => {
    const grandchild = agent('question:string -> answer:string', {
      agentIdentity: { name: 'Grandchild', description: 'A grandchild' },
      contextFields: [],
      runtime,
    });

    const child = agent('topic:string -> summary:string', {
      agentIdentity: { name: 'Child', description: 'A child agent' },
      agents: { local: [grandchild] },
      contextFields: [],
      runtime,
    });

    agent('query:string, context:string, userId:string -> finalAnswer:string', {
      agents: { local: [child] },
      contextFields: ['context'],
      fields: { globallyShared: ['context', 'userId'] },
      runtime,
    });

    // Child should have 'context' in its contextFields
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const childContextFields = (child as any).rlmConfig.contextFields;
    expect(childContextFields).toContain('context');

    // Grandchild should also have 'context' in its contextFields
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const grandchildContextFields = (grandchild as any).rlmConfig.contextFields;
    expect(grandchildContextFields).toContain('context');
  });

  it('should not duplicate fields already in descendant signature', () => {
    const child = agent('topic:string, userId:string -> summary:string', {
      agentIdentity: { name: 'Child', description: 'A child agent' },
      contextFields: [],
      runtime,
    });

    agent('query:string, userId:string -> finalAnswer:string', {
      agents: { local: [child] },
      contextFields: [],
      fields: { globallyShared: ['userId'] },
      runtime,
    });

    // Child already had userId — no duplicate
    const childInputs = child
      .getSignature()
      .getInputFields()
      .map((f) => f.name);
    const userIdCount = childInputs.filter((n) => n === 'userId').length;
    expect(userIdCount).toBe(1);
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
      agents: { local: [childAgent] },
      contextFields: [],
      fields: { shared: ['userId'] },
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
      agents: { local: [childAgent] },
      contextFields: [],
      fields: { shared: ['userId'] },
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
      fields: { excluded: ['userId'] },
      runtime,
    });

    agent('query:string, userId:string -> answer:string', {
      agents: { local: [childAgent] },
      contextFields: [],
      fields: { shared: ['userId'] },
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
      agents: { local: [childAgent] },
      contextFields: [],
      fields: { shared: ['userId', 'sessionId'] },
      runtime,
    });

    const params = childAgent.getFunction().parameters!;
    // Own fields present
    expect(params.properties?.question).toBeDefined();
    // Both injected shared fields absent
    expect(params.properties?.userId).toBeUndefined();
    expect(params.properties?.sessionId).toBeUndefined();
  });

  it('should scope _parentSharedFields independently in a grandparent → parent → child chain', () => {
    const grandchild = agent('question:string -> answer:string', {
      agentIdentity: { name: 'Grandchild', description: 'A grandchild agent' },
      contextFields: [],
      runtime,
    });

    const child = agent('topic:string -> summary:string', {
      agentIdentity: { name: 'Child', description: 'A child agent' },
      agents: { local: [grandchild] },
      contextFields: [],
      fields: { shared: ['topic'] },
      runtime,
    });

    agent('query:string, userId:string, topic:string -> finalAnswer:string', {
      agents: { local: [child] },
      contextFields: [],
      fields: { shared: ['userId', 'topic'] },
      runtime,
    });

    // Grandchild: 'topic' was shared by its parent (child) — should be hidden
    const grandchildParams = grandchild.getFunction().parameters!;
    expect(grandchildParams.properties?.question).toBeDefined();
    expect(grandchildParams.properties?.topic).toBeUndefined();
    // 'userId' was NOT shared by child to grandchild — should not appear at all
    expect(grandchildParams.properties?.userId).toBeUndefined();

    // Child: 'topic' is its OWN input field — should remain visible.
    // 'userId' was injected by grandparent — should be hidden.
    const childParams = child.getFunction().parameters!;
    expect(childParams.properties?.topic).toBeDefined(); // child owns this
    expect(childParams.properties?.userId).toBeUndefined(); // injected by grandparent
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

  it('should render ### Available Agent Functions section when agents are provided', () => {
    const result = axBuildActorDefinition(undefined, [], [], {
      agents: [
        {
          name: 'searchAgent',
          description: 'Searches the web',
          parameters: sampleSchema,
        },
      ],
    });
    expect(result).toContain('### Available Agent Functions');
    expect(result).toContain(
      '- `agents.searchAgent(args: { query: string, limit?: number }): Promise<unknown>`'
    );
  });

  it('should render required and optional params in TypeScript-style signature', () => {
    const result = axBuildActorDefinition(undefined, [], [], {
      agents: [
        {
          name: 'searchAgent',
          description: 'desc',
          parameters: sampleSchema,
        },
      ],
    });
    expect(result).toContain('query: string');
    expect(result).toContain('limit?: number');
  });

  it('should render ### Available Functions section when agentFunctions are provided', () => {
    const result = axBuildActorDefinition(undefined, [], [], {
      agentFunctions: [
        {
          name: 'fetchData',
          description: 'Fetches remote data',
          parameters: sampleSchema,
          namespace: 'utils',
        },
      ],
    });
    expect(result).toContain('### Available Functions');
    expect(result).toContain(
      '- `utils.fetchData(args: { query: string, limit?: number }): Promise<unknown>`'
    );
  });

  it('should omit sub-agents section when agents array is empty', () => {
    const result = axBuildActorDefinition(undefined, [], [], { agents: [] });
    expect(result).not.toContain('### Available Agent Functions');
  });

  it('should omit functions section when agentFunctions array is empty', () => {
    const result = axBuildActorDefinition(undefined, [], [], {
      agentFunctions: [],
    });
    expect(result).not.toContain('### Available Functions');
  });

  it('should omit both sections when neither option is provided', () => {
    const result = axBuildActorDefinition(undefined, [], [], {});
    expect(result).not.toContain('### Available Agent Functions');
    expect(result).not.toContain('### Available Functions');
  });

  it('should render {} for agent with undefined parameters', () => {
    const result = axBuildActorDefinition(undefined, [], [], {
      agents: [
        { name: 'noParamsAgent', description: 'desc', parameters: undefined },
      ],
    });
    expect(result).toContain(
      '- `agents.noParamsAgent(args: {}): Promise<unknown>`'
    );
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
    expect(result).toContain(
      '- `agents.emptyAgent(args: {}): Promise<unknown>`'
    );
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
    expect(result).toContain('- `agents.agentOne(args: ');
    expect(result).toContain('- `agents.agentTwo(args: ');
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
      agentFunctions: [
        {
          name: 'batchFetch',
          description: 'desc',
          parameters: arraySchema,
          namespace: 'utils',
        },
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

  it('should render boolean type params correctly', () => {
    const boolSchema: AxFunctionJSONSchema = {
      type: 'object',
      properties: {
        verbose: { type: 'boolean', description: 'Enable verbose output' },
      },
      required: ['verbose'],
    };
    const result = axBuildActorDefinition(undefined, [], [], {
      agentFunctions: [
        {
          name: 'configure',
          description: 'desc',
          parameters: boolSchema,
          namespace: 'utils',
        },
      ],
    });
    expect(result).toContain('verbose: boolean');
  });

  it('should render union params with TypeScript pipe syntax', () => {
    const unionSchema: AxFunctionJSONSchema = {
      type: 'object',
      properties: {
        maybeText: {
          type: ['string', 'null'],
          description: 'Optional text value',
        },
      },
      required: ['maybeText'],
    };
    const result = axBuildActorDefinition(undefined, [], [], {
      agents: [
        { name: 'unionAgent', description: 'desc', parameters: unionSchema },
      ],
    });
    expect(result).toContain('maybeText: string | null');
  });

  it('should render broad json unions as any for readability', () => {
    const jsonUnionSchema: AxFunctionJSONSchema = {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Task' },
        context: {
          type: ['object', 'array', 'string', 'number', 'boolean', 'null'],
          description: 'Generic context',
        },
      },
      required: ['task'],
    };
    const result = axBuildActorDefinition(undefined, [], [], {
      agents: [
        {
          name: 'searchAgent',
          description: 'desc',
          parameters: jsonUnionSchema,
        },
      ],
    });
    expect(result).toContain('task: string, context?: any');
  });

  it('should render primitive return schemas in call signatures', () => {
    const result = axBuildActorDefinition(undefined, [], [], {
      agentFunctions: [
        {
          name: 'countMatches',
          description: 'Counts matches',
          parameters: sampleSchema,
          returns: { type: 'number' },
          namespace: 'utils',
        },
      ],
    });
    expect(result).toContain(
      '- `utils.countMatches(args: { query: string, limit?: number }): Promise<number>`'
    );
  });

  it('should render union return schemas with TypeScript pipe syntax', () => {
    const result = axBuildActorDefinition(undefined, [], [], {
      agentFunctions: [
        {
          name: 'maybeFind',
          description: 'Finds maybe',
          parameters: sampleSchema,
          returns: { type: ['string', 'null'] },
          namespace: 'utils',
        },
      ],
    });
    expect(result).toContain(
      '- `utils.maybeFind(args: { query: string, limit?: number }): Promise<string | null>`'
    );
  });

  it('should render open object parameter schemas as index signatures', () => {
    const result = axBuildActorDefinition(undefined, [], [], {
      agents: [
        {
          name: 'mapAgent',
          description: 'Accepts key/value map',
          parameters: { type: 'object', additionalProperties: true },
        },
      ],
    });
    expect(result).toContain(
      '- `agents.mapAgent(args: { [key: string]: unknown }): Promise<unknown>`'
    );
  });

  it('should include index signature for object params with explicit properties and additionalProperties=true', () => {
    const openObjectSchema: AxFunctionJSONSchema = {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Query' },
      },
      required: ['query'],
      additionalProperties: true,
    };
    const result = axBuildActorDefinition(undefined, [], [], {
      agentFunctions: [
        {
          name: 'openQuery',
          description: 'Open query',
          parameters: openObjectSchema,
          namespace: 'utils',
        },
      ],
    });
    expect(result).toContain(
      '- `utils.openQuery(args: { query: string, [key: string]: unknown }): Promise<unknown>`'
    );
  });

  it('should render object type params correctly', () => {
    const objSchema: AxFunctionJSONSchema = {
      type: 'object',
      properties: {
        config: { type: 'object', description: 'Configuration object' },
      },
      required: ['config'],
    };
    const result = axBuildActorDefinition(undefined, [], [], {
      agents: [
        { name: 'setupAgent', description: 'desc', parameters: objSchema },
      ],
    });
    expect(result).toContain('config: object');
  });

  it('actor program description should include sub-agent call signatures end-to-end', () => {
    const childAgent = agent('question:string -> answer:string', {
      agentIdentity: {
        name: 'Physics Researcher',
        description: 'Answers physics questions',
      },
      contextFields: [],
      runtime,
    });

    const parentAgent = agent('query:string -> finalAnswer:string', {
      agents: { local: [childAgent] },
      contextFields: [],
      runtime,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actorDescription = (parentAgent as any).actorProgram
      .getSignature()
      .getDescription();

    expect(actorDescription).toContain('### Available Agent Functions');
    expect(actorDescription).toContain(
      '- `agents.physicsResearcher(args: { question: string }): Promise<unknown>`'
    );
  });

  it('actor program description should include agent function call signatures end-to-end', () => {
    const parentAgent = agent('query:string -> finalAnswer:string', {
      functions: {
        local: [
          {
            name: 'lookupData',
            description: 'Looks up data in the database',
            parameters: sampleSchema,
            func: async () => 'result',
          },
        ],
      },
      contextFields: [],
      runtime,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actorDescription = (parentAgent as any).actorProgram
      .getSignature()
      .getDescription();

    expect(actorDescription).toContain('### Available Functions');
    expect(actorDescription).toContain(
      '- `utils.lookupData(args: { query: string, limit?: number }): Promise<unknown>`'
    );
  });

  it('should render sorted function entries by namespace then name', () => {
    const result = axBuildActorDefinition(undefined, [], [], {
      agentFunctions: [
        {
          name: 'zeta',
          description: 'zeta fn',
          parameters: sampleSchema,
          namespace: 'utils',
        },
        {
          name: 'alpha',
          description: 'alpha fn',
          parameters: sampleSchema,
          namespace: 'db',
        },
        {
          name: 'beta',
          description: 'beta fn',
          parameters: sampleSchema,
          namespace: 'db',
        },
      ],
    });

    const alpha = result.indexOf('`db.alpha(args: ');
    const beta = result.indexOf('`db.beta(args: ');
    const zeta = result.indexOf('`utils.zeta(args: ');
    expect(alpha).toBeGreaterThan(-1);
    expect(beta).toBeGreaterThan(alpha);
    expect(zeta).toBeGreaterThan(beta);
  });

  it('should render unknown return type when return schema is missing', () => {
    const result = axBuildActorDefinition(undefined, [], [], {
      agentFunctions: [
        {
          name: 'fetchData',
          description: 'Fetches data',
          parameters: sampleSchema,
          namespace: 'utils',
        },
      ],
    });
    expect(result).toContain(
      '- `utils.fetchData(args: { query: string, limit?: number }): Promise<unknown>`'
    );
  });
});

// ----- AxFunction tests -----

describe('AxFunction', () => {
  const runtime: AxCodeRuntime = {
    getUsageInstructions: () => '',
    createSession() {
      return { execute: async () => 'ok', close: () => {} };
    },
  };

  it('should register agent functions under default "utils" namespace in runtime globals', () => {
    const myAgent = new AxAgent(
      { signature: 'query:string -> answer:string' },
      {
        contextFields: [],
        runtime,
        functions: {
          local: [
            {
              name: 'fetchData',
              description: 'Fetches data',
              parameters: {
                type: 'object',
                properties: { url: { type: 'string' } },
                required: ['url'],
              },
              func: async () => 'result',
            },
          ],
        },
      }
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const globals = (myAgent as any).buildRuntimeGlobals();
    expect(globals).toHaveProperty('utils');
    expect(globals.utils).toHaveProperty('fetchData');
    expect(typeof globals.utils.fetchData).toBe('function');
  });

  it('should register agent functions under custom namespace', () => {
    const myAgent = new AxAgent(
      { signature: 'query:string -> answer:string' },
      {
        contextFields: [],
        runtime,
        functions: {
          local: [
            {
              name: 'processImage',
              description: 'Processes an image',
              parameters: {
                type: 'object',
                properties: { url: { type: 'string' } },
                required: ['url'],
              },
              namespace: 'media',
              func: async () => 'processed',
            },
          ],
        },
      }
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const globals = (myAgent as any).buildRuntimeGlobals();
    expect(globals).toHaveProperty('media');
    expect(globals.media).toHaveProperty('processImage');
    expect(globals).not.toHaveProperty('utils');
  });

  it('should throw on reserved namespace', () => {
    for (const ns of ['agents', 'llmQuery', 'final', 'ask_clarification']) {
      expect(
        () =>
          new AxAgent(
            { signature: 'query:string -> answer:string' },
            {
              contextFields: [],
              runtime,
              functions: {
                local: [
                  {
                    name: 'badFn',
                    description: 'bad',
                    parameters: { type: 'object', properties: {} },
                    namespace: ns,
                    func: async () => 'x',
                  },
                ],
              },
            }
          )
      ).toThrow(`Agent function namespace "${ns}" is reserved`);
    }
  });

  it('should require parameters for functions used in agent runtime', () => {
    expect(
      () =>
        new AxAgent(
          { signature: 'query:string -> answer:string' },
          {
            contextFields: [],
            runtime,
            functions: {
              local: [
                {
                  name: 'missingSchema',
                  description: 'Missing parameters',
                  func: async () => 'x',
                },
              ],
            },
          }
        )
    ).toThrow(
      'Agent function "missingSchema" must define parameters schema for agent runtime usage.'
    );
  });

  it('should render agent functions in actor prompt with namespace', () => {
    const myAgent = agent('query:string -> answer:string', {
      contextFields: [],
      runtime,
      functions: {
        local: [
          {
            name: 'searchDB',
            description: 'Searches the database',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Search query' },
                limit: { type: 'number', description: 'Max results' },
              },
              required: ['query'],
            },
            returns: {
              type: 'object',
              properties: {
                results: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Results',
                },
              },
            },
            namespace: 'db',
            func: async () => [],
          },
        ],
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actorDesc = (myAgent as any).actorProgram
      .getSignature()
      .getDescription();

    expect(actorDesc).toContain('### Available Functions');
    expect(actorDesc).toContain(
      '- `db.searchDB(args: { query: string, limit?: number }): Promise<{ results: string[] }>`'
    );
    expect(actorDesc).not.toContain('async function db.searchDB(');
  });

  it('should propagate shared agent functions to direct children', () => {
    const sharedFn: AxFunction = {
      name: 'sharedUtil',
      description: 'A shared utility',
      parameters: {
        type: 'object',
        properties: { input: { type: 'string' } },
        required: ['input'],
      },
      func: async () => 'shared-result',
    };

    const child = agent('question:string -> answer:string', {
      agentIdentity: { name: 'Child', description: 'A child' },
      contextFields: [],
      runtime,
    });

    agent('query:string -> finalAnswer:string', {
      agents: { local: [child] },
      contextFields: [],
      runtime,
      functions: { shared: [sharedFn] },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const childFunctions = (child as any).agentFunctions as AxFunction[];
    expect(childFunctions.map((f) => f.name)).toContain('sharedUtil');
  });

  it('should NOT propagate shared agent functions to grandchildren', () => {
    const sharedFn: AxFunction = {
      name: 'sharedUtil',
      description: 'A shared utility',
      parameters: {
        type: 'object',
        properties: { input: { type: 'string' } },
        required: ['input'],
      },
      func: async () => 'shared-result',
    };

    const grandchild = agent('question:string -> answer:string', {
      agentIdentity: { name: 'Grandchild', description: 'A grandchild' },
      contextFields: [],
      runtime,
    });

    const child = agent('topic:string -> summary:string', {
      agentIdentity: { name: 'Child', description: 'A child' },
      agents: { local: [grandchild] },
      contextFields: [],
      runtime,
    });

    agent('query:string -> finalAnswer:string', {
      agents: { local: [child] },
      contextFields: [],
      runtime,
      functions: { shared: [sharedFn] },
    });

    // Child should have it
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const childFunctions = (child as any).agentFunctions as AxFunction[];
    expect(childFunctions.map((f) => f.name)).toContain('sharedUtil');

    // Grandchild should NOT have it
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const grandchildFunctions = (grandchild as any)
      .agentFunctions as AxFunction[];
    expect(grandchildFunctions.map((f) => f.name)).not.toContain('sharedUtil');
  });

  it('should propagate globallyShared agent functions to all descendants', () => {
    const globalFn: AxFunction = {
      name: 'globalUtil',
      description: 'A global utility',
      parameters: {
        type: 'object',
        properties: { input: { type: 'string' } },
        required: ['input'],
      },
      func: async () => 'global-result',
    };

    const grandchild = agent('question:string -> answer:string', {
      agentIdentity: { name: 'Grandchild', description: 'A grandchild' },
      contextFields: [],
      runtime,
    });

    const child = agent('topic:string -> summary:string', {
      agentIdentity: { name: 'Child', description: 'A child' },
      agents: { local: [grandchild] },
      contextFields: [],
      runtime,
    });

    agent('query:string -> finalAnswer:string', {
      agents: { local: [child] },
      contextFields: [],
      runtime,
      functions: { globallyShared: [globalFn] },
    });

    // Child should have it
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const childFunctions = (child as any).agentFunctions as AxFunction[];
    expect(childFunctions.map((f) => f.name)).toContain('globalUtil');

    // Grandchild should ALSO have it
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const grandchildFunctions = (grandchild as any)
      .agentFunctions as AxFunction[];
    expect(grandchildFunctions.map((f) => f.name)).toContain('globalUtil');
  });

  it('should respect functions.excluded to block shared agent functions', () => {
    const sharedFn: AxFunction = {
      name: 'blockedFn',
      description: 'Should be blocked',
      parameters: {
        type: 'object',
        properties: { input: { type: 'string' } },
        required: ['input'],
      },
      func: async () => 'blocked',
    };

    const child = agent('question:string -> answer:string', {
      agentIdentity: { name: 'Child', description: 'A child' },
      contextFields: [],
      runtime,
      functions: { excluded: ['blockedFn'] },
    });

    agent('query:string -> finalAnswer:string', {
      agents: { local: [child] },
      contextFields: [],
      runtime,
      functions: { shared: [sharedFn] },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const childFunctions = (child as any).agentFunctions as AxFunction[];
    expect(childFunctions.map((f) => f.name)).not.toContain('blockedFn');
  });

  it('should throw on duplicate agent function propagated from parent', () => {
    const fn1: AxFunction = {
      name: 'dupFn',
      description: 'First',
      parameters: { type: 'object', properties: {} },
      func: async () => 'a',
    };

    const fn2: AxFunction = {
      name: 'dupFn',
      description: 'Second',
      parameters: { type: 'object', properties: {} },
      func: async () => 'b',
    };

    const child = agent('question:string -> answer:string', {
      agentIdentity: { name: 'Child', description: 'A child' },
      contextFields: [],
      runtime,
    });

    expect(() =>
      agent('query:string -> finalAnswer:string', {
        agents: { local: [child] },
        contextFields: [],
        runtime,
        functions: { shared: [fn1, fn2] },
      })
    ).toThrow(/Duplicate shared agent function/);
  });

  it('should skip shared function when child already defines it locally', () => {
    const localFn: AxFunction = {
      name: 'myFn',
      description: 'Child version',
      parameters: { type: 'object', properties: {} },
      func: async () => 'child-version',
    };

    const parentSharedFn: AxFunction = {
      name: 'myFn',
      description: 'Parent version',
      parameters: { type: 'object', properties: {} },
      func: async () => 'parent-version',
    };

    const child = agent('question:string -> answer:string', {
      agentIdentity: { name: 'Child', description: 'A child' },
      contextFields: [],
      runtime,
      functions: { local: [localFn] },
    });

    // Should NOT throw — child owns it locally
    agent('query:string -> finalAnswer:string', {
      agents: { local: [child] },
      contextFields: [],
      runtime,
      functions: { shared: [parentSharedFn] },
    });

    // Child should still have its own version
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const childFunctions = (child as any).agentFunctions as AxFunction[];
    const myFn = childFunctions.find((f) => f.name === 'myFn');
    expect(myFn?.description).toBe('Child version');
  });

  it('should respect agents.excluded to block shared agents', () => {
    const utilityAgent = agent('taskInput:string -> taskOutput:string', {
      agentIdentity: { name: 'Utility', description: 'A utility agent' },
      contextFields: [],
      runtime,
    });

    const child = agent('question:string -> answer:string', {
      agentIdentity: { name: 'Child', description: 'A child' },
      contextFields: [],
      runtime,
      agents: { excluded: ['utility'] },
    });

    agent('query:string -> finalAnswer:string', {
      agents: { local: [child], shared: [utilityAgent] },
      contextFields: [],
      runtime,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const childAgents = (child as any).agents as any[] | undefined;
    const childAgentNames = (childAgents ?? []).map(
      (a: any) => a.getFunction().name
    );
    expect(childAgentNames).not.toContain('utility');
  });

  it('should dedup agent functions by namespace.name across namespaces', () => {
    const fn1: AxFunction = {
      name: 'process',
      description: 'Utils process',
      parameters: { type: 'object', properties: {} },
      namespace: 'utils',
      func: async () => 'a',
    };

    const fn2: AxFunction = {
      name: 'process',
      description: 'Media process',
      parameters: { type: 'object', properties: {} },
      namespace: 'media',
      func: async () => 'b',
    };

    // Same name different namespace — should NOT throw
    const child = agent('question:string -> answer:string', {
      agentIdentity: { name: 'Child', description: 'A child' },
      contextFields: [],
      runtime,
    });

    agent('query:string -> finalAnswer:string', {
      agents: { local: [child] },
      contextFields: [],
      runtime,
      functions: { shared: [fn1, fn2] },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const childFunctions = (child as any).agentFunctions as AxFunction[];
    expect(childFunctions).toHaveLength(2);
    expect(childFunctions.map((f) => `${f.namespace}.${f.name}`)).toEqual(
      expect.arrayContaining(['utils.process', 'media.process'])
    );
  });
});
