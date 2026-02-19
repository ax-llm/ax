import { describe, expect, it } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
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
  createSession() {
    return {
      execute: async () => 'ok',
      close: () => {},
    };
  },
};

/** Default rlm config for tests that don't need RLM behavior */
const defaultRlm = {
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
      { rlm: defaultRlm }
    );

    expect(() => a.getFunction()).toThrow(/agentIdentity/);
  });

  it('should append additional text to Actor prompt via setActorDescription', () => {
    const a = new AxAgent(
      {
        signature: 'query: string -> answer: string',
      },
      { rlm: defaultRlm }
    );

    a.setActorDescription('Always prefer concise code.');

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
          { rlm: defaultRlm }
        )
    ).toThrow(/setActorDescription\(\) and\/or setResponderDescription\(\)/);
  });

  it('should append additional text to Responder prompt via setResponderDescription', () => {
    const a = new AxAgent(
      {
        signature: 'query: string -> answer: string',
      },
      { rlm: defaultRlm }
    );

    a.setResponderDescription('Always respond in bullet points.');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const responderDesc = (a as any).responderProgram
      .getSignature()
      .getDescription() as string;
    // Should contain the base RLM prompt
    expect(responderDesc).toContain('Answer Synthesis Agent');
    // Should also contain the appended text
    expect(responderDesc).toContain('Always respond in bullet points.');
  });

  it('should replace (not accumulate) when setActorDescription is called twice', () => {
    const a = new AxAgent(
      {
        signature: 'query: string -> answer: string',
      },
      { rlm: defaultRlm }
    );

    a.setActorDescription('First instruction.');
    a.setActorDescription('Second instruction.');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actorDesc = (a as any).actorProgram
      .getSignature()
      .getDescription() as string;
    expect(actorDesc).toContain('Code Generation Agent');
    expect(actorDesc).toContain('Second instruction.');
    expect(actorDesc).not.toContain('First instruction.');
  });

  it('should allow independent actor and responder descriptions', () => {
    const a = new AxAgent(
      {
        signature: 'query: string -> answer: string',
      },
      { rlm: defaultRlm }
    );

    a.setActorDescription('Actor-specific guidance.');
    a.setResponderDescription('Responder-specific guidance.');

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
    createSession() {
      return { execute: async () => 'ok', close: () => {} };
    },
  };

  it('should derive Actor signature with actionLog input and code output', () => {
    const testAgent = agent('context:string, query:string -> answer:string', {
      rlm: { contextFields: ['context'], runtime },
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

  it('should derive Responder signature with original outputs', () => {
    const testAgent = agent(
      'context:string, query:string -> answer:string, confidence:number',
      {
        rlm: { contextFields: ['context'], runtime },
      }
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const responderSig = (testAgent as any).responderProgram.getSignature();
    const inputs = responderSig.getInputFields();
    const outputs = responderSig.getOutputFields();

    // Responder inputs include actionLog and contextMetadata
    expect(inputs.find((f: AxIField) => f.name === 'actionLog')).toBeDefined();
    expect(
      inputs.find((f: AxIField) => f.name === 'contextMetadata')
    ).toBeDefined();

    // Responder outputs are the original business outputs
    expect(outputs.find((f: AxIField) => f.name === 'answer')).toBeDefined();
    expect(
      outputs.find((f: AxIField) => f.name === 'confidence')
    ).toBeDefined();
  });

  it('should work with no context fields', () => {
    const testAgent = agent('query:string -> answer:string', {
      rlm: { contextFields: [], runtime },
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
  it('should exit loop when Actor returns done()', async () => {
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
          // Second call: signal done
          return {
            results: [
              {
                index: 0,
                content: 'Javascript Code: done()',
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
      createSession() {
        return {
          execute: async (code: string) => {
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
      rlm: {
        contextFields: ['context'],
        runtime,
      },
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
          // Never return done() — always return code
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
      createSession() {
        return {
          execute: async () => 'ok',
          close: () => {},
        };
      },
    };

    const testAgent = agent('context:string, query:string -> answer:string', {
      ai: testMockAI,
      rlm: {
        contextFields: ['context'],
        runtime,
        maxTurns: 3,
      },
    });

    const result = await testAgent.forward(testMockAI, {
      context: 'unused',
      query: 'unused',
    });

    expect(actorCallCount).toBe(3);
    expect(result.answer).toBe('forced answer after max turns');
  });

  it('should accumulate actionLog across turns', async () => {
    let lastActionLogValue = '';

    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          return {
            results: [
              {
                index: 0,
                content: 'Javascript Code: done()',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }

        if (systemPrompt.includes('Answer Synthesis Agent')) {
          // Capture the actionLog that was passed to the Responder
          const userPrompt = String(req.chatPrompt[1]?.content ?? '');
          lastActionLogValue = userPrompt;
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
      createSession() {
        return {
          execute: async () => 'executed',
          close: () => {},
        };
      },
    };

    const testAgent = agent('context:string, query:string -> answer:string', {
      ai: testMockAI,
      rlm: {
        contextFields: ['context'],
        runtime,
      },
    });

    await testAgent.forward(testMockAI, {
      context: 'unused',
      query: 'unused',
    });

    // Since Actor returned done() on first call, no actions were taken
    expect(lastActionLogValue).toContain('no actions were taken');
  });

  it('should exit loop when Actor returns legacy "DONE" (with quotes)', async () => {
    let actorCallCount = 0;
    let responderCalled = false;

    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

        if (systemPrompt.includes('Code Generation Agent')) {
          actorCallCount++;
          // Return "DONE" with quotes — the bug scenario
          return {
            results: [
              {
                index: 0,
                content: 'Javascript Code: "DONE"',
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
      rlm: {
        contextFields: [],
        runtime: defaultRuntime,
      },
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
      rlm: {
        contextFields: [],
        runtime,
        maxTurns: 1,
      },
    });

    await testAgent.forward(testMockAI, { query: 'test' });

    expect(functionCalled).toBe(true);
    expect(functionArg).toBe('test');
  });
});

// ----- done() as runtime global -----

describe('done() as runtime global', () => {
  it('should exit actor loop when done() is called inline with code', async () => {
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
                content: 'Javascript Code: var x = 42; done()',
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
      createSession(globals) {
        return {
          execute: async (code: string) => {
            executedCode = code;
            // Simulate calling the done function from globals
            if (globals?.done && code.includes('done()')) {
              (globals.done as () => void)();
            }
            return 42;
          },
          close: () => {},
        };
      },
    };

    const testAgent = agent('query:string -> answer:string', {
      ai: testMockAI,
      rlm: {
        contextFields: [],
        runtime,
      },
    });

    const result = await testAgent.forward(testMockAI, { query: 'test' });

    // Actor should be called only once — done() signals exit after execution
    expect(actorCallCount).toBe(1);
    expect(responderCalled).toBe(true);
    expect(result.answer).toBe('inline done result');
    // The code with trailing done() stripped should have been executed
    expect(executedCode).toContain('var x = 42');
  });

  it('should pass done function in session globals and include in reservedNames', async () => {
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
                content: 'Javascript Code: done()',
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
      createSession(globals) {
        receivedGlobals = globals ?? {};
        return {
          execute: async () => 'ok',
          close: () => {},
        };
      },
    };

    const testAgent = agent('query:string -> answer:string', {
      ai: testMockAI,
      rlm: {
        contextFields: [],
        runtime,
      },
    });

    await testAgent.forward(testMockAI, { query: 'test' });

    // done should be passed as a session global
    expect(receivedGlobals).toHaveProperty('done');
    expect(typeof receivedGlobals.done).toBe('function');
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
      rlm: defaultRlm,
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
      rlm: defaultRlm,
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
      rlm: defaultRlm,
    });
    const agent2 = agent(axSig, {
      ai: mockAI,
      rlm: defaultRlm,
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
      rlm: defaultRlm,
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
    const result = axBuildActorDefinition(undefined, [], {});
    expect(result).toContain('## Code Generation Agent');
  });

  it('should render context field types', () => {
    const fields: AxIField[] = [
      { name: 'query', title: 'Query', type: { name: 'string' } },
    ];
    const result = axBuildActorDefinition(undefined, fields, {});
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
    const result = axBuildActorDefinition(undefined, fields, {});
    expect(result).toContain("- `query` (string): The user's search query");
  });

  it('should document done() exit signal', () => {
    const result = axBuildActorDefinition(undefined, [], {});
    expect(result).toContain('done()');
  });

  it('should document llmQuery API', () => {
    const result = axBuildActorDefinition(undefined, [], {});
    expect(result).toContain('await llmQuery(query, context?)');
    expect(result).toContain('await llmQuery([{ query, context? }, ...])');
  });

  it('should list tool functions when provided', () => {
    const tools = [
      {
        name: 'searchDocs',
        description: 'Search through documents',
        parameters: {
          type: 'object' as const,
          properties: {
            query: { type: 'string', description: 'Search query' },
          },
          required: ['query'],
        },
        func: async () => 'result',
      },
    ];
    const result = axBuildActorDefinition(undefined, [], {
      toolFunctions: tools,
    });
    expect(result).toContain('await searchDocs');
    expect(result).toContain('Search through documents');
  });

  it('should append runtime usage instructions', () => {
    const result = axBuildActorDefinition(undefined, [], {
      runtimeUsageInstructions: 'Use var instead of const.',
    });
    expect(result).toContain('### Runtime-specific usage notes');
    expect(result).toContain('Use var instead of const.');
  });

  it('should include maxTurns in rules', () => {
    const result = axBuildActorDefinition(undefined, [], {
      maxTurns: 5,
    });
    expect(result).toContain('5 turns maximum');
  });

  it('should append base definition', () => {
    const result = axBuildActorDefinition(
      'You are a helpful assistant.',
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

  it('should instruct to base answer on action log evidence', () => {
    const result = axBuildResponderDefinition(undefined, []);
    expect(result).toContain(
      'Base your answer ONLY on evidence from the action log'
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

        if (systemPrompt.includes('Answer the query')) {
          if (userPrompt.includes('Query: fail')) {
            throw new Error('boom');
          }
          return {
            results: [{ index: 0, content: 'ok', finishReason: 'stop' }],
            modelUsage: makeModelUsage(),
          };
        }

        if (systemPrompt.includes('Code Generation Agent')) {
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

    let batchResult: string[] = [];
    const runtime: AxCodeRuntime = {
      createSession(globals) {
        return {
          execute: async () => {
            const llmQueryFn = globals?.llmQuery as (
              q: readonly { query: string; context?: string }[]
            ) => Promise<string[]>;
            batchResult = await llmQueryFn([
              { query: 'ok', context: 'ctx1' },
              { query: 'fail', context: 'ctx2' },
            ]);
            return JSON.stringify(batchResult);
          },
          close: () => {},
        };
      },
    };

    const testAgent = agent('context:string, query:string -> answer:string', {
      ai: testMockAI,
      rlm: {
        contextFields: ['context'],
        runtime,
        maxTurns: 1,
      },
    });

    await testAgent.forward(testMockAI, {
      context: 'unused',
      query: 'unused',
    });

    expect(batchResult[0]).toBe('ok');
    expect(batchResult[1]).toContain('[ERROR] boom');
  });

  it('should normalize single-object llmQuery({ query, context }) to positional args', async () => {
    let llmQueryResult = '';

    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');

        if (systemPrompt.includes('Answer the query')) {
          return {
            results: [
              { index: 0, content: 'sub-lm-answer', finishReason: 'stop' },
            ],
            modelUsage: makeModelUsage(),
          };
        }

        if (systemPrompt.includes('Code Generation Agent')) {
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

    const runtime: AxCodeRuntime = {
      createSession(globals) {
        return {
          execute: async () => {
            const llmQueryFn = globals?.llmQuery as (q: {
              query: string;
              context?: string;
            }) => Promise<string>;
            llmQueryResult = await llmQueryFn({
              query: 'summarize this',
              context: 'some context',
            });
            return llmQueryResult;
          },
          close: () => {},
        };
      },
    };

    const testAgent = agent('context:string, query:string -> answer:string', {
      ai: testMockAI,
      rlm: {
        contextFields: ['context'],
        runtime,
        maxTurns: 1,
      },
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
      rlm: {
        contextFields: ['context'],
        runtime,
        maxTurns: 1,
      },
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
                content: 'Javascript Code: done()',
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
      rlm: {
        contextFields: ['context'],
        runtime,
      },
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
                content: 'Javascript Code: done()',
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
      rlm: {
        contextFields: ['context'],
        runtime,
      },
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
                content: 'Javascript Code: done()',
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
      { rlm: defaultRlm }
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
                    : 'Javascript Code: done()',
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
      { rlm: defaultRlm }
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
                    : 'Javascript Code: done()',
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
      { rlm: defaultRlm }
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
      { rlm: defaultRlm }
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
      { rlm: defaultRlm }
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
      { rlm: { ...defaultRlm, actorFields: ['reasoning'] } }
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
      { rlm: defaultRlm }
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
      { rlm: defaultRlm }
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
      { rlm: defaultRlm }
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
      { rlm: defaultRlm }
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
                    : 'Javascript Code: done()',
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
      { rlm: defaultRlm }
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

// ----- Streaming tests -----

describe('streamingForward', () => {
  it('should yield streaming deltas from the Responder', async () => {
    let actorCallCount = 0;

    const mockAI = new AxMockAIService({
      features: { functions: false, streaming: true },
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
                    ? 'Javascript Code: "gather"'
                    : 'Javascript Code: done()',
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
              content: 'Answer: streamed result',
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
      { rlm: defaultRlm }
    );

    const deltas: unknown[] = [];
    for await (const delta of testAgent.streamingForward(mockAI, {
      query: 'test',
    })) {
      deltas.push(delta);
    }

    // Should yield at least one delta
    expect(deltas.length).toBeGreaterThan(0);
  });
});

// ----- actorFields tests -----

describe('actorFields', () => {
  const runtime: AxCodeRuntime = {
    createSession() {
      return { execute: async () => 'ok', close: () => {} };
    },
  };

  it('should split output fields between Actor and Responder based on actorFields', () => {
    const testAgent = agent(
      'context:string, query:string -> answer:string, reasoning:string, confidence:number',
      {
        rlm: {
          contextFields: ['context'],
          runtime,
          actorFields: ['reasoning'],
        },
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
        rlm: {
          contextFields: [],
          runtime,
          actorFields: ['nonexistent'],
        },
      })
    ).toThrow(/actorField "nonexistent" not found in output signature/);
  });

  it('should update Actor prompt rules when actorFields are set', () => {
    const testAgent = agent('query:string -> answer:string, reasoning:string', {
      rlm: {
        contextFields: [],
        runtime,
        actorFields: ['reasoning'],
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actorDesc = (testAgent as any).actorProgram
      .getSignature()
      .getDescription() as string;

    // Should mention the actor field in the rules
    expect(actorDesc).toContain('`reasoning`');
    // Should NOT have the strict "Output ONLY" rule
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
                content: 'Javascript Code: done()\nReasoning: Final reasoning',
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
      rlm: {
        contextFields: [],
        runtime,
        actorFields: ['reasoning'],
      },
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
    createSession() {
      return { execute: async () => 'ok', close: () => {} };
    },
  };

  it('should call actorCallback on every Actor turn including done()', async () => {
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
                content: 'Javascript Code: done()',
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
      rlm: {
        contextFields: [],
        runtime,
        actorCallback: async (result) => {
          callbackResults.push(result);
        },
      },
    });

    await testAgent.forward(testMockAI, { query: 'test' });

    // Callback should fire on both turns (code + done())
    expect(callbackResults).toHaveLength(2);
    expect(callbackResults[0]?.javascriptCode).toBe('var x = 1');
    expect(callbackResults[1]?.javascriptCode).toBe('done()');
  });
});

// ----- actorOptions / responderOptions tests -----

describe('actorOptions / responderOptions', () => {
  const runtime: AxCodeRuntime = {
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
                content: 'Javascript Code: done()',
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
      rlm: { contextFields: [], runtime },
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
                content: 'Javascript Code: done()',
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
      rlm: { contextFields: [], runtime },
      responderOptions: { model: 'responder-model' },
    });

    await testAgent.forward(testMockAI, { query: 'test' });

    expect(capturedResponderModel).toBe('responder-model');
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
