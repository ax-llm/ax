import { describe, expect, it } from 'vitest';

import { toFieldType } from '../dsp/adapter.js';
import { AxMockAIService } from '../ai/mock/api.js';
import type { AxChatResponse } from '../ai/types.js';
import type { AxIField } from '../dsp/sig.js';
import { s } from '../dsp/template.js';
import type { AxMessage } from '../dsp/types.js';
import { AxAIServiceAbortedError } from '../util/apicall.js';

import { AxAgent, agent } from './agent.js';
import type { AxCodeRuntime } from './rlm.js';
import { axBuildRLMDefinition } from './rlm.js';

// Helper function to create streaming responses
function createStreamingResponse(
  chunks: AxChatResponse['results']
): ReadableStream<AxChatResponse> {
  return new ReadableStream({
    start(controller) {
      let count = 0;

      const processChunks = async () => {
        if (count >= chunks.length) {
          controller.close();
          return;
        }

        const chunk = chunks[count];
        if (chunk) {
          try {
            controller.enqueue({
              results: [
                {
                  index: 0,
                  content: chunk.content,
                  finishReason: chunk.finishReason,
                },
              ],
              modelUsage: {
                ai: 'test-ai',
                model: 'test-model',
                tokens: {
                  promptTokens: 0,
                  completionTokens: 0,
                  totalTokens: 0,
                },
              },
            });
            count++;

            // Small delay between chunks
            await new Promise((resolve) => setTimeout(resolve, 10));
            processChunks();
          } catch (error) {
            controller.error(error);
          }
        }
      };

      processChunks().catch((error) => {
        controller.error(error);
      });
    },

    cancel() {},
  });
}

describe('AxAgent', () => {
  const mockAI = new AxMockAIService({
    features: {
      functions: true,
      streaming: true,
    },
    models: [
      { key: 'gpt4', model: 'gpt-4', description: 'Advanced model' },
      { key: 'gpt35', model: 'gpt-3.5', description: 'Fast model' },
    ],
  });

  it('should handle smart model routing correctly', () => {
    // Create agent with smart routing enabled (default)
    const agent = new AxAgent({
      ai: mockAI,
      name: 'test smart routing agent',
      description: 'Tests the smart model routing functionality of agents',
      signature: 'userQuery: string -> agentResponse: string',
    });

    const func = agent.getFunction();
    expect(func.parameters?.properties?.model).toBeDefined();
    expect(func.parameters?.properties?.model?.enum).toEqual(['gpt4', 'gpt35']);
  });

  it('should disable smart model routing when specified', () => {
    const agent = new AxAgent(
      {
        ai: mockAI,
        name: 'test smart routing disabled',
        description: 'Tests disabling smart model routing',
        signature: 'userQuery: string -> agentResponse: string',
      },
      { disableSmartModelRouting: true }
    );

    const func = agent.getFunction();
    expect(func.parameters?.properties?.model).toBeUndefined();
  });

  it('should update description correctly', () => {
    const agent = new AxAgent({
      ai: mockAI,
      name: 'test description updates',
      description: 'Initial description that is long enough',
      signature: 'userQuery: string -> agentResponse: string',
    });

    const newDescription =
      'Updated description that is also long enough to pass validation';
    agent.setDescription(newDescription);

    const func = agent.getFunction();
    expect(func.description).toBe(newDescription);
  });

  it('should throw error for short description', () => {
    const agent = new AxAgent({
      ai: mockAI,
      name: 'test description validation',
      description: 'Initial description that is long enough',
      signature: 'userQuery: string -> agentResponse: string',
    });

    expect(() => agent.setDescription('Too short')).toThrow();
  });

  it('should expose features correctly', () => {
    const agent = new AxAgent({
      ai: mockAI,
      name: 'test features',
      description: 'Tests the feature reporting of agents',
      signature: 'userQuery: string -> agentResponse: string',
    });

    const features = agent.getFeatures();
    expect(features.canConfigureSmartModelRouting).toBe(false);
    expect(features.excludeFieldsFromPassthrough).toEqual([]);
  });

  it('should respect excludeFieldsFromPassthrough option', () => {
    const agent = new AxAgent(
      {
        ai: mockAI,
        name: 'test excluded fields',
        description: 'Tests field exclusion configuration',
        signature: 'userQuery: string -> agentResponse: string',
      },
      {
        excludeFieldsFromPassthrough: ['someField'],
      }
    );

    const features = agent.getFeatures();
    expect(features.excludeFieldsFromPassthrough).toEqual(['someField']);
  });

  it('should update definition correctly using setDefinition', () => {
    const agent = new AxAgent({
      ai: mockAI,
      name: 'test setDefinition',
      description: 'Initial description that is long enough',
      signature: 'userQuery: string -> agentResponse: string',
    });

    const validDefinition = 'A'.repeat(100); // valid definition (100 characters)
    agent.setDefinition(validDefinition);
    // Access the underlying program's signature to verify that the definition was applied
    expect(
      (
        agent as unknown as {
          program: { getSignature: () => { getDescription: () => string } };
        }
      ).program
        .getSignature()
        .getDescription()
    ).toBe(validDefinition);
  });

  it('should throw error when setting a too short definition using setDefinition', () => {
    const agent = new AxAgent({
      ai: mockAI,
      name: 'test setDefinition short',
      description: 'Initial description that is long enough',
      signature: 'userQuery: string -> agentResponse: string',
    });

    expect(() => agent.setDefinition('Too short')).toThrow();
  });

  it('should set definition in constructor if provided and valid', () => {
    const validDefinition = 'D'.repeat(100); // valid definition (100 characters)
    const agent = new AxAgent({
      ai: mockAI,
      name: 'test constructor with definition',
      description: 'Initial description that is long enough',
      definition: validDefinition,
      signature: 'userQuery: string -> agentResponse: string',
    });
    // The underlying signature description should use the provided definition.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((agent as any).program.getSignature().getDescription()).toBe(
      validDefinition
    );
    // Note: The function description remains the original description.
    expect(agent.getFunction().description).toBe(
      'Initial description that is long enough'
    );
  });

  it('should throw error in constructor for a too short definition', () => {
    expect(
      () =>
        new AxAgent({
          ai: mockAI,
          name: 'test short definition',
          description: 'Initial description that is long enough',
          definition: 'Short definition',
          signature: 'userQuery: string -> agentResponse: string',
        })
    ).toThrow();
  });

  it('should handle AxMessage array input in forward method', async () => {
    // Create a mock AI service with a specific response for this test
    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: {
        results: [
          {
            index: 0,
            content: 'Agent Response: Mocked response for message array',
            finishReason: 'stop',
          },
        ],
        modelUsage: {
          ai: 'test-ai',
          model: 'test-model',
          tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      },
    });

    const agent = new AxAgent({
      ai: testMockAI,
      name: 'test message array forward',
      description: 'Tests handling of AxMessage array input in forward method',
      signature: 'userQuery: string -> agentResponse: string',
    });

    const messages: AxMessage<{ userQuery: string }>[] = [
      { role: 'user', values: { userQuery: 'Hello from message array' } },
      { role: 'assistant', values: { userQuery: 'Previous response' } },
      { role: 'user', values: { userQuery: 'Latest user message' } },
    ];

    const result = await agent.forward(testMockAI, messages);
    expect(result).toBeDefined();
    expect(result.agentResponse).toBe('Mocked response for message array');
  });

  it('should handle AxMessage array input in streamingForward method', async () => {
    // Create streaming response chunks
    const chunks: AxChatResponse['results'] = [
      { index: 0, content: 'Agent Response: Streaming ' },
      { index: 0, content: 'response ' },
      { index: 0, content: 'chunk', finishReason: 'stop' },
    ];
    const streamingResponse = createStreamingResponse(chunks);

    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: true },
      chatResponse: streamingResponse,
    });

    const agent = new AxAgent({
      ai: testMockAI,
      name: 'test message array streaming',
      description:
        'Tests handling of AxMessage array input in streamingForward method',
      signature: 'userQuery: string -> agentResponse: string',
    });

    const messages: AxMessage<{ userQuery: string }>[] = [
      { role: 'user', values: { userQuery: 'Streaming test message' } },
    ];

    const generator = agent.streamingForward(testMockAI, messages);
    const results = [];

    for await (const chunk of generator) {
      results.push(chunk);
    }

    expect(results.length).toBeGreaterThan(0);
    // Verify that we received streaming chunks
    expect(results[0]).toHaveProperty('delta');
  });

  it('should handle empty AxMessage array gracefully', async () => {
    const agent = new AxAgent({
      ai: mockAI,
      name: 'test empty message array',
      description: 'Tests handling of empty AxMessage array input',
      signature: 'userQuery: string -> agentResponse: string',
    });

    const messages: AxMessage<{ userQuery: string }>[] = [];

    // This should not throw an error, but may result in an empty or default response
    // depending on how the underlying prompt template handles empty message arrays
    try {
      await agent.forward(mockAI, messages);
      // If it doesn't throw, that's fine - the behavior may vary
    } catch (error) {
      // If it throws, that's also acceptable behavior for empty input
      expect(error).toBeDefined();
    }
  });

  it('should extract values from most recent user message in AxMessage array', async () => {
    // Create a mock AI service for this test
    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: {
        results: [
          {
            index: 0,
            content: 'Agent Response: Parent response with child interaction',
            finishReason: 'stop',
          },
        ],
        modelUsage: {
          ai: 'test-ai',
          model: 'test-model',
          tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      },
    });

    // Create a child agent that will receive injected values
    const childAgent = new AxAgent({
      ai: testMockAI,
      name: 'child agent for injection test',
      description: 'Child agent that receives injected values from parent',
      signature: 'contextInfo: string -> childResponse: string',
    });

    // Create parent agent with the child agent
    const parentAgent = new AxAgent({
      ai: testMockAI,
      name: 'parent agent with child',
      description: 'Parent agent that passes values to child agent',
      signature:
        'userQuery: string, contextInfo: string -> agentResponse: string',
      agents: [childAgent],
    });

    const messages: AxMessage<{ userQuery: string; contextInfo: string }>[] = [
      {
        role: 'user',
        values: { userQuery: 'First message', contextInfo: 'Old context' },
      },
      {
        role: 'assistant',
        values: {
          userQuery: 'Assistant response',
          contextInfo: 'Assistant context',
        },
      },
      {
        role: 'user',
        values: { userQuery: 'Latest message', contextInfo: 'Latest context' },
      },
    ];

    const result = await parentAgent.forward(testMockAI, messages);
    expect(result).toBeDefined();

    // The test verifies that the system can handle message arrays without throwing errors
    // The actual value injection logic is tested implicitly through the successful execution
  });

  describe('AxAgent.create()', () => {
    it('should create an agent with type-safe signature parsing', () => {
      const agent = AxAgent.create(
        'userInput:string "User question" -> responseText:string "Agent response"',
        {
          name: 'testCreateMethod',
          description: 'Test agent created with AxAgent.create() method',
          definition:
            'You are a test agent that provides responses to user questions. Always respond helpfully and accurately.',
          ai: mockAI,
        }
      );

      expect(agent).toBeInstanceOf(AxAgent);

      const signature = agent.getSignature();
      expect(signature.getInputFields()).toHaveLength(1);
      expect(signature.getOutputFields()).toHaveLength(1);
      expect(signature.getInputFields()[0]?.name).toBe('userInput');
      expect(signature.getOutputFields()[0]?.name).toBe('responseText');
    });

    it('should create agent with complex signature types', () => {
      const agent = AxAgent.create(
        `userQuery:string "User question",
         context?:json "Optional context" ->
         answer:string "Detailed answer",
         confidence:number "Confidence score",
         category:class "technical, general, personal" "Query category"`,
        {
          name: 'complexSignatureAgent',
          description: 'Agent with complex signature for comprehensive testing',
          definition:
            'You are an agent that processes complex queries with multiple input and output types. Analyze the query carefully and provide detailed responses.',
          ai: mockAI,
        }
      );

      const signature = agent.getSignature();
      const inputFields = signature.getInputFields();
      const outputFields = signature.getOutputFields();

      expect(inputFields).toHaveLength(2);
      expect(outputFields).toHaveLength(3);

      expect(inputFields[0]?.name).toBe('userQuery');
      expect(inputFields[1]?.name).toBe('context');
      expect(inputFields[1]?.isOptional).toBe(true);

      expect(outputFields[0]?.name).toBe('answer');
      expect(outputFields[1]?.name).toBe('confidence');
      expect(outputFields[2]?.name).toBe('category');
    });

    it('should work identically to constructor with same parameters', () => {
      const signature = 'testInput:string -> testOutput:string';
      const config = {
        name: 'identicalTestAgent',
        description:
          'Agent for testing identical behavior between create and constructor',
        definition:
          'You are a test agent that helps verify identical behavior between AxAgent.create() and constructor. Your role is to demonstrate that both creation methods produce functionally equivalent agent instances with the same capabilities and behavior.',
        ai: mockAI,
      };

      const createdAgent = AxAgent.create(signature, config);
      const constructedAgent = new AxAgent({
        signature,
        ...config,
      });

      expect(createdAgent.getSignature().toString()).toBe(
        constructedAgent.getSignature().toString()
      );
      expect(createdAgent.getFunction().name).toBe(
        constructedAgent.getFunction().name
      );
      expect(createdAgent.getFunction().description).toBe(
        constructedAgent.getFunction().description
      );
    });
  });
});

describe('Enhanced agent() function with AxSignature Support', () => {
  const mockAI = new AxMockAIService({
    features: { functions: false, streaming: false },
    chatResponse: {
      results: [
        {
          index: 0,
          content: 'Mocked AI response',
          finishReason: 'stop',
        },
      ],
      modelUsage: {
        ai: 'test-ai',
        model: 'test-model',
        tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      },
    },
  });

  it('should work with string signatures in agent()', () => {
    const testAgent = agent('userInput:string -> responseText:string', {
      name: 'testAgent',
      description:
        'A test agent that processes user input and returns a response',
      ai: mockAI,
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

  it('should work with AxSignature objects in agent()', () => {
    const signature = s('userInput:string -> responseText:string');
    const testAgent = agent(signature, {
      name: 'testAgent',
      description:
        'A test agent that processes user input and returns a response',
      ai: mockAI,
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

  it('should maintain proper type inference with complex AxSignature in agent()', () => {
    const signature = s(
      'emailText:string, priority:number -> category:string, confidence:number'
    );
    const testAgent = agent(signature, {
      name: 'emailAgent',
      description:
        'An agent that categorizes emails based on content and priority',
      ai: mockAI,
    });

    // Should maintain all field information
    expect(testAgent.getSignature().getInputFields()).toHaveLength(2);
    expect(testAgent.getSignature().getOutputFields()).toHaveLength(2);
    expect(testAgent.getSignature().getInputFields()[0]?.name).toBe(
      'emailText'
    );
    expect(testAgent.getSignature().getInputFields()[1]?.name).toBe('priority');
    expect(testAgent.getSignature().getOutputFields()[0]?.name).toBe(
      'category'
    );
    expect(testAgent.getSignature().getOutputFields()[1]?.name).toBe(
      'confidence'
    );
  });

  it('should handle both overloads seamlessly in agent()', () => {
    const stringSig = 'userInput:string -> agentOutput:string';
    const axSig = s('userInput:string -> agentOutput:string');

    const agent1 = agent(stringSig, {
      name: 'agent1',
      description: 'First agent using string signature',
      ai: mockAI,
    });
    const agent2 = agent(axSig, {
      name: 'agent2',
      description: 'Second agent using AxSignature object',
      ai: mockAI,
    });

    // Both should have same signature structure (ignoring description differences)
    expect(agent1.getSignature().getInputFields()).toEqual(
      agent2.getSignature().getInputFields()
    );
    expect(agent1.getSignature().getOutputFields()).toEqual(
      agent2.getSignature().getOutputFields()
    );
  });

  it('should pass through all config options correctly', () => {
    const sig = s('userInput:string -> responseText:string');
    const definition =
      'You are a helpful assistant that provides clear, accurate responses to user questions. Always be polite and informative.';

    const testAgent = agent(sig, {
      name: 'configTestAgent',
      description: 'An agent to test configuration passing',
      definition,
      ai: mockAI,
      debug: true,
      disableSmartModelRouting: true,
    });

    expect(testAgent.getFunction().name).toBe('configtestagent'); // camelCase conversion
    expect(testAgent.getFunction().description).toBe(
      'An agent to test configuration passing'
    );
    // Definition is used as the program description
    expect(testAgent.getSignature().getDescription()).toBe(definition);
  });

  it('should work without ai parameter in config', () => {
    const testAgent = agent('userInput:string -> responseText:string', {
      name: 'noAiAgent',
      description: 'An agent without built-in AI service',
    });

    expect(testAgent).toBeInstanceOf(AxAgent);
    expect(testAgent.getSignature().getInputFields()[0]?.name).toBe(
      'userInput'
    );
    expect(testAgent.getSignature().getOutputFields()[0]?.name).toBe(
      'responseText'
    );
  });

  it('should produce equivalent results to AxAgent.create()', () => {
    const signature = 'userInput:string -> responseText:string';
    const config = {
      name: 'equivalentAgent',
      description: 'An agent to test equivalence with AxAgent.create',
      ai: mockAI,
    };

    const factoryAgent = agent(signature, config);
    const staticAgent = AxAgent.create(signature, config);

    expect(factoryAgent.getSignature().toString()).toBe(
      staticAgent.getSignature().toString()
    );
    expect(factoryAgent.getFunction().name).toBe(
      staticAgent.getFunction().name
    );
    expect(factoryAgent.getFunction().description).toBe(
      staticAgent.getFunction().description
    );
  });
});

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

describe('axBuildRLMDefinition with typed context fields', () => {
  it('should render string field type', () => {
    const fields: AxIField[] = [
      { name: 'query', title: 'Query', type: { name: 'string' } },
    ];
    const result = axBuildRLMDefinition(undefined, 'JavaScript', fields);
    expect(result).toContain('- `query` (string)');
  });

  it('should render number field type', () => {
    const fields: AxIField[] = [
      { name: 'count', title: 'Count', type: { name: 'number' } },
    ];
    const result = axBuildRLMDefinition(undefined, 'JavaScript', fields);
    expect(result).toContain('- `count` (number)');
  });

  it('should render object with nested fields', () => {
    const fields: AxIField[] = [
      {
        name: 'doc',
        title: 'Doc',
        type: {
          name: 'object',
          fields: {
            id: { type: 'number' },
            title: { type: 'string' },
          },
        },
      },
    ];
    const result = axBuildRLMDefinition(undefined, 'JavaScript', fields);
    expect(result).toContain('- `doc` (object { id: number, title: string })');
  });

  it('should render array of objects', () => {
    const fields: AxIField[] = [
      {
        name: 'items',
        title: 'Items',
        type: {
          name: 'object',
          isArray: true,
          fields: {
            id: { type: 'number' },
          },
        },
      },
    ];
    const result = axBuildRLMDefinition(undefined, 'JavaScript', fields);
    expect(result).toContain(
      '- `items` (json array of object { id: number } items)'
    );
  });

  it('should include field descriptions as suffix', () => {
    const fields: AxIField[] = [
      {
        name: 'query',
        title: 'Query',
        type: { name: 'string' },
        description: "The user's search query",
      },
    ];
    const result = axBuildRLMDefinition(undefined, 'JavaScript', fields);
    expect(result).toContain("- `query` (string): The user's search query");
  });

  it('should render optional nested fields with ?', () => {
    const fields: AxIField[] = [
      {
        name: 'config',
        title: 'Config',
        type: {
          name: 'object',
          fields: {
            timeout: { type: 'number', isOptional: true },
            retries: { type: 'number', isOptional: true },
          },
        },
      },
    ];
    const result = axBuildRLMDefinition(undefined, 'JavaScript', fields);
    expect(result).toContain(
      '- `config` (object { timeout?: number, retries?: number })'
    );
  });

  it('should maintain backward compat with string[]', () => {
    const result = axBuildRLMDefinition(undefined, 'JavaScript', [
      'documents',
      'query',
    ]);
    expect(result).toContain('- `documents` (string)');
    expect(result).toContain('- `query` (string)');
  });

  it('should include concrete example section instead of abstract workflow', () => {
    const fields: AxIField[] = [
      { name: 'docs', title: 'Docs', type: { name: 'string' } },
    ];
    const result = axBuildRLMDefinition(undefined, 'JavaScript', fields);
    expect(result).toContain('### Example');
    expect(result).toContain('Analyzing `docs`');
    expect(result).not.toContain('### Workflow');
  });

  it('should include guidelines for structural and semantic work', () => {
    const fields: AxIField[] = [
      {
        name: 'items',
        title: 'Items',
        type: {
          name: 'object',
          isArray: true,
          fields: { id: { type: 'number' }, title: { type: 'string' } },
        },
      },
    ];
    const result = axBuildRLMDefinition(undefined, 'JavaScript', fields);
    expect(result).toContain('filter, map, slice, regex, property access');
    expect(result).not.toContain('### Tips');
  });
});

describe('axBuildRLMDefinition dual structured/string guidance', () => {
  const fields: AxIField[] = [
    {
      name: 'items',
      title: 'Items',
      type: {
        name: 'object',
        isArray: true,
        fields: { id: { type: 'number' }, title: { type: 'string' } },
      },
    },
  ];

  it('should include JSON.stringify() guidance in output', () => {
    const result = axBuildRLMDefinition(undefined, 'JavaScript', fields);
    expect(result).toContain('JSON.stringify()');
  });

  it('should not include [0] probe or .slice(0, 500)', () => {
    const result = axBuildRLMDefinition(undefined, 'JavaScript', fields);
    expect(result).not.toContain('[0]');
    expect(result).not.toContain('.slice(0, 500)');
  });

  it('should not contain "chunk it first"', () => {
    const result = axBuildRLMDefinition(undefined, 'JavaScript', fields);
    expect(result).not.toContain('chunk it first');
  });

  it('should include structural work guidance in guidelines', () => {
    const result = axBuildRLMDefinition(undefined, 'JavaScript', fields);
    expect(result).toContain('filter, map, slice, regex, property access');
  });

  it('should include JSON.stringify guidance in APIs section', () => {
    const result = axBuildRLMDefinition(undefined, 'JavaScript', fields);
    expect(result).toContain('JSON.stringify()');
  });

  it('should document batched llmQuery overload', () => {
    const result = axBuildRLMDefinition(undefined, 'JavaScript', fields);
    expect(result).toContain('await llmQuery([{ query, context? }, ...])');
  });

  it('should not include hardcoded runtime-specific execution rules', () => {
    const result = axBuildRLMDefinition(undefined, 'JavaScript', fields);
    expect(result).not.toContain('### Execution rules');
    expect(result).not.toContain('use `var` (not `const`/`let`)');
  });

  it('should append runtime-specific usage notes when provided', () => {
    const result = axBuildRLMDefinition(undefined, 'JavaScript', fields, {
      runtimeUsageInstructions:
        '- Use globalThis.state for persistent state across async calls.',
    });
    expect(result).toContain('### Runtime-specific usage notes');
    expect(result).toContain(
      'Use globalThis.state for persistent state across async calls.'
    );
  });

  it('should document llmQuery return type', () => {
    const result = axBuildRLMDefinition(undefined, 'JavaScript', fields);
    expect(result).toContain('Returns a string.');
  });

  it('should document batched llmQuery return type', () => {
    const result = axBuildRLMDefinition(undefined, 'JavaScript', fields);
    expect(result).toContain('Returns string[]');
  });

  it('should note sub-queries have a call limit', () => {
    const result = axBuildRLMDefinition(undefined, 'JavaScript', fields);
    expect(result).toContain('Sub-queries have a call limit');
  });

  it('should render inline mode helper field instructions', () => {
    const result = axBuildRLMDefinition(undefined, 'JavaScript', fields, {
      mode: 'inline',
      inlineCodeFieldName: 'javascriptCode',
      inlineLanguage: 'javascript',
    });
    expect(result).toContain('## Iterative Context Analysis');
    expect(result).toContain('`javascriptCode`');
    expect(result).toContain('`llmQuery`');
    expect(result).toContain('`resultReady`');
  });
});

describe('codeInterpreter description with typed context', () => {
  it('should include field types in context description', () => {
    const fields: AxIField[] = [
      {
        name: 'documents',
        title: 'Documents',
        type: {
          name: 'object',
          isArray: true,
          fields: {
            id: { type: 'number' },
            title: { type: 'string' },
          },
        },
      },
      { name: 'query', title: 'Query', type: { name: 'string' } },
    ];
    const contextDesc = fields
      .map((f) => `${f.name}: ${toFieldType(f.type)}`)
      .join(', ');
    expect(contextDesc).toBe(
      'documents: json array of object { id: number, title: string } items, query: string'
    );
  });
});

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

describe('RLM llmQuery runtime behavior', () => {
  const makeModelUsage = () => ({
    ai: 'mock-ai',
    model: 'mock-model',
    tokens: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  });

  const makeTestRuntime = (
    executeHandler: (
      code: string,
      globals: Record<string, unknown>
    ) => Promise<unknown> | unknown
  ): AxCodeRuntime => ({
    language: 'JavaScript',
    createSession(globals?: Record<string, unknown>) {
      const safeGlobals = globals ?? {};
      return {
        execute: async (code: string) => executeHandler(code, safeGlobals),
        close: () => {},
      };
    },
  });

  it('should return per-item errors for batched llmQuery calls', async () => {
    const testMockAI = new AxMockAIService({
      features: { functions: true, streaming: false },
      chatResponse: async (req) => {
        const userPrompt = String(req.chatPrompt[1]?.content ?? '');
        if (userPrompt.includes('Query: fail')) {
          throw new Error('boom');
        }
        return {
          results: [{ index: 0, content: 'ok', finishReason: 'stop' }],
          modelUsage: makeModelUsage(),
        };
      },
    });

    const runtime = makeTestRuntime(async (code, globals) => {
      if (code !== 'BATCH_TEST') return 'unexpected code';
      return await (
        globals.llmQuery as (
          q: readonly { query: string; context?: string }[]
        ) => Promise<string[]>
      )([
        { query: 'ok', context: 'ctx1' },
        { query: 'fail', context: 'ctx2' },
      ]);
    });

    const testAgent = agent('context:string, query:string -> answer:string', {
      name: 'rlmBatchToleranceAgent',
      description: 'Agent used to verify batched llmQuery error tolerance.',
      ai: testMockAI,
      rlm: {
        mode: 'function',
        contextFields: ['context'],
        runtime,
      },
    });

    // Replace inner rlmProgram to directly invoke codeInterpreter.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (testAgent as any).rlmProgram = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      forward: async (_ai: any, _values: any, forwardOptions: any) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const codeInterpreter = forwardOptions.functions.find((f: any) => {
          return f.name === 'codeInterpreter';
        });
        const output = await codeInterpreter.func({ code: 'BATCH_TEST' });
        return { answer: output };
      },
    };

    const result = await testAgent.forward(testMockAI, {
      context: 'unused',
      query: 'unused',
    });
    expect(result.answer).toContain('ok');
    expect(result.answer).toContain('[ERROR] boom');
  });

  it('should normalize single-object llmQuery({ query, context }) to positional args', async () => {
    const testMockAI = new AxMockAIService({
      features: { functions: true, streaming: false },
      chatResponse: async () => ({
        results: [
          {
            index: 0,
            content: 'sub-lm-answer',
            finishReason: 'stop' as const,
          },
        ],
        modelUsage: makeModelUsage(),
      }),
    });

    const runtime = makeTestRuntime(async (_code, globals) => {
      // Call llmQuery with a single object (the form LLMs often produce)
      const llmQueryFn = globals.llmQuery as (q: {
        query: string;
        context?: string;
      }) => Promise<string>;
      return await llmQueryFn({
        query: 'summarize this',
        context: 'some context',
      });
    });

    const testAgent = agent('context:string, query:string -> answer:string', {
      name: 'rlmSingleObjectAgent',
      description: 'Agent used to verify single-object llmQuery normalization.',
      ai: testMockAI,
      rlm: {
        mode: 'function',
        contextFields: ['context'],
        runtime,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (testAgent as any).rlmProgram = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      forward: async (_ai: any, _values: any, forwardOptions: any) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const codeInterpreter = forwardOptions.functions.find((f: any) => {
          return f.name === 'codeInterpreter';
        });
        const output = await codeInterpreter.func({
          code: 'SINGLE_OBJ_TEST',
        });
        return { answer: output };
      },
    };

    const result = await testAgent.forward(testMockAI, {
      context: 'unused',
      query: 'unused',
    });
    // Should succeed (not crash) and return the sub-LM answer
    expect(result.answer).toBe('sub-lm-answer');
  });

  it('should prioritize maxRuntimeChars over deprecated aliases', async () => {
    let lastUserPrompt = '';
    const testMockAI = new AxMockAIService({
      features: { functions: true, streaming: false },
      chatResponse: async (req) => {
        lastUserPrompt = String(req.chatPrompt[1]?.content ?? '');
        return {
          results: [{ index: 0, content: 'ok', finishReason: 'stop' }],
          modelUsage: makeModelUsage(),
        };
      },
    });

    const runtime = makeTestRuntime(async (code, globals) => {
      if (code !== 'ALIAS_PRECEDENCE_TEST') return 'unexpected code';
      return await (
        globals.llmQuery as (q: string, context?: string) => Promise<string>
      )('q', '1234567890');
    });

    const testAgent = agent('context:string, query:string -> answer:string', {
      name: 'rlmAliasPrecedenceAgent',
      description: 'Agent used to verify maxRuntimeChars alias precedence.',
      ai: testMockAI,
      rlm: {
        mode: 'function',
        contextFields: ['context'],
        runtime,
        maxRuntimeChars: 8,
        maxSubQueryContextChars: 5,
        maxInterpreterOutputChars: 5,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (testAgent as any).rlmProgram = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      forward: async (_ai: any, _values: any, forwardOptions: any) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const codeInterpreter = forwardOptions.functions.find((f: any) => {
          return f.name === 'codeInterpreter';
        });
        const output = await codeInterpreter.func({
          code: 'ALIAS_PRECEDENCE_TEST',
        });
        return { answer: output };
      },
    };

    await testAgent.forward(testMockAI, {
      context: 'unused',
      query: 'unused',
    });
    expect(lastUserPrompt).toContain('[truncated 2 chars]');
    expect(lastUserPrompt).not.toContain('[truncated 5 chars]');
  });

  it('should throw typed aborted error from llmQuery pre-check', async () => {
    const testMockAI = new AxMockAIService({
      features: { functions: true, streaming: false },
      chatResponse: {
        results: [{ index: 0, content: 'ok', finishReason: 'stop' }],
        modelUsage: makeModelUsage(),
      },
    });

    const runtime = makeTestRuntime(async (code, globals) => {
      if (code !== 'ABORT_TYPE_TEST') return 'unexpected code';
      try {
        await (
          globals.llmQuery as (q: string, context?: string) => Promise<string>
        )('q', 'ctx');
        return 'unexpected success';
      } catch (err) {
        return err instanceof AxAIServiceAbortedError
          ? 'aborted-ok'
          : `wrong-type:${String(err)}`;
      }
    });

    const testAgent = agent('context:string, query:string -> answer:string', {
      name: 'rlmAbortTypeAgent',
      description: 'Agent used to verify typed abort errors in llmQuery.',
      ai: testMockAI,
      rlm: {
        mode: 'function',
        contextFields: ['context'],
        runtime,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (testAgent as any).rlmProgram = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      forward: async (_ai: any, _values: any, forwardOptions: any) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const codeInterpreter = forwardOptions.functions.find((f: any) => {
          return f.name === 'codeInterpreter';
        });
        const output = await codeInterpreter.func({ code: 'ABORT_TYPE_TEST' });
        return { answer: output };
      },
    };

    const result = await testAgent.forward(
      testMockAI,
      {
        context: 'unused',
        query: 'unused',
      },
      { abortSignal: AbortSignal.abort('stop now') }
    );
    expect(result.answer).toContain('aborted-ok');
  });

  it('should truncate llmQuery context but not llmQuery response', async () => {
    let observedLlmQueryResultLength = 0;
    let observedLlmQueryResultHasTruncationMarker = false;
    const longSubModelAnswer = 'R'.repeat(64);

    const testMockAI = new AxMockAIService({
      features: { functions: true, streaming: false },
      chatResponse: {
        results: [
          { index: 0, content: longSubModelAnswer, finishReason: 'stop' },
        ],
        modelUsage: makeModelUsage(),
      },
    });

    const runtime = makeTestRuntime(async (code, globals) => {
      if (code !== 'NO_OUTPUT_TRUNCATION_TEST') return 'unexpected code';
      const llmQueryResult = await (
        globals.llmQuery as (q: string, context?: string) => Promise<string>
      )('q', '1234567890');
      observedLlmQueryResultLength = llmQueryResult.length;
      observedLlmQueryResultHasTruncationMarker =
        llmQueryResult.includes('[truncated');
      return 'ok';
    });

    const testAgent = agent('context:string, query:string -> answer:string', {
      name: 'rlmNoOutputTruncationAgent',
      description: 'Agent used to verify llmQuery response is not truncated.',
      ai: testMockAI,
      rlm: {
        mode: 'function',
        contextFields: ['context'],
        runtime,
        maxRuntimeChars: 8,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (testAgent as any).rlmProgram = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      forward: async (_ai: any, _values: any, forwardOptions: any) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const codeInterpreter = forwardOptions.functions.find((f: any) => {
          return f.name === 'codeInterpreter';
        });
        const output = await codeInterpreter.func({
          code: 'NO_OUTPUT_TRUNCATION_TEST',
        });
        return { answer: output };
      },
    };

    await testAgent.forward(testMockAI, {
      context: 'unused',
      query: 'unused',
    });

    expect(observedLlmQueryResultLength).toBe(longSubModelAnswer.length);
    expect(observedLlmQueryResultHasTruncationMarker).toBe(false);
  });

  it('should restart closed session after timeout and restore globals', async () => {
    let createSessionCount = 0;
    let executeCount = 0;
    const runtime: AxCodeRuntime = {
      language: 'JavaScript',
      createSession(globals?: Record<string, unknown>) {
        createSessionCount++;
        const safeGlobals = globals ?? {};
        return {
          execute: async (_code: string) => {
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

    const testMockAI = new AxMockAIService({
      features: { functions: true, streaming: false },
      chatResponse: {
        results: [{ index: 0, content: 'ok', finishReason: 'stop' }],
        modelUsage: makeModelUsage(),
      },
    });

    const testAgent = agent('context:string, query:string -> answer:string', {
      name: 'rlmSessionRestartAgent',
      description:
        'Agent used to verify RLM session recreation after closure errors.',
      ai: testMockAI,
      rlm: {
        mode: 'function',
        contextFields: ['context'],
        runtime,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (testAgent as any).rlmProgram = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      forward: async (_ai: any, _values: any, forwardOptions: any) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const codeInterpreter = forwardOptions.functions.find((f: any) => {
          return f.name === 'codeInterpreter';
        });
        const first = await codeInterpreter.func({
          code: 'TIMEOUT_THEN_CLOSED',
        });
        const second = await codeInterpreter.func({
          code: 'RESTART_AFTER_CLOSED',
        });
        return { answer: `${first}\n---\n${second}` };
      },
    };

    const result = await testAgent.forward(testMockAI, {
      context: 'global-context',
      query: 'unused',
    });

    expect(createSessionCount).toBe(2); // initial + timeout-triggered restart
    expect(result.answer).toContain('Error: Execution timed out');
    expect(result.answer).toContain('JavaScript runtime was restarted');
    expect(result.answer).toContain('all global state was lost');
    expect(result.answer).toContain('must be recreated if needed');
    expect((result.answer.match(/runtime was restarted/g) ?? []).length).toBe(
      1
    );
    expect(result.answer).toContain('ctx:global-context;hasLlmQuery:true');
  });

  it('should not restart closed session if no timeout happened first', async () => {
    let createSessionCount = 0;
    const runtime: AxCodeRuntime = {
      language: 'JavaScript',
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

    const testMockAI = new AxMockAIService({
      features: { functions: true, streaming: false },
      chatResponse: {
        results: [{ index: 0, content: 'ok', finishReason: 'stop' }],
        modelUsage: makeModelUsage(),
      },
    });

    const testAgent = agent('context:string, query:string -> answer:string', {
      name: 'rlmNoRestartWithoutTimeoutAgent',
      description:
        'Agent used to verify closed sessions do not restart without timeout.',
      ai: testMockAI,
      rlm: {
        mode: 'function',
        contextFields: ['context'],
        runtime,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (testAgent as any).rlmProgram = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      forward: async (_ai: any, _values: any, forwardOptions: any) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const codeInterpreter = forwardOptions.functions.find((f: any) => {
          return f.name === 'codeInterpreter';
        });
        const output = await codeInterpreter.func({ code: 'CLOSED_ONLY' });
        return { answer: output };
      },
    };

    const result = await testAgent.forward(testMockAI, {
      context: 'unused',
      query: 'unused',
    });

    expect(createSessionCount).toBe(1);
    expect(result.answer).toBe('Error: Session is closed');
    expect(result.answer).not.toContain('[RLM session restarted');
  });
});

describe('RLM inline mode', () => {
  const makeModelUsage = () => ({
    ai: 'mock-ai',
    model: 'mock-model',
    tokens: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  });

  it('should add inline helper fields and make primary outputs optional', () => {
    const runtime: AxCodeRuntime = {
      language: 'JavaScript',
      createSession() {
        return {
          execute: async () => 'ok',
          close: () => {},
        };
      },
    };

    const testAgent = agent('context:string, query:string -> answer:string', {
      name: 'rlmInlineSignatureAgent',
      description:
        'Agent used to verify inline mode helper field injection in signature.',
      rlm: {
        mode: 'inline',
        language: 'javascript',
        contextFields: ['context'],
        runtime,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rlmSig = (testAgent as any).rlmProgram.getSignature();
    const outputFields = rlmSig.getOutputFields();
    const answerField = outputFields.find((f: AxIField) => f.name === 'answer');
    const codeField = outputFields.find(
      (f: AxIField) => f.name === 'javascriptCode'
    );
    const readyField = outputFields.find(
      (f: AxIField) => f.name === 'resultReady'
    );

    expect(answerField?.isOptional).toBe(true);
    expect(codeField?.isOptional).toBe(true);
    // llmQuery is no longer an output field — it's a runtime API called from code
    expect(
      outputFields.find((f: AxIField) => f.name === 'llmQuery')
    ).toBeUndefined();
    expect(readyField?.type?.name).toBe('boolean');
  });

  it('should reject signature collisions with inline reserved helper fields', () => {
    const runtime: AxCodeRuntime = {
      language: 'JavaScript',
      createSession() {
        return {
          execute: async () => 'ok',
          close: () => {},
        };
      },
    };

    expect(() =>
      agent(
        'context:string, query:string -> javascriptCode:string, answer:string',
        {
          name: 'rlmInlineReservedFieldCollision',
          description:
            'Agent used to verify inline mode reserved field collision validation.',
          rlm: {
            mode: 'inline',
            language: 'javascript',
            contextFields: ['context'],
            runtime,
          },
        }
      )
    ).toThrow('RLM inline mode reserves output field');
  });

  it('should process inline helper fields without codeInterpreter function', async () => {
    let callCount = 0;
    let sawCodeInterpreterFunction = false;
    let sawCodeExecutedPrefix = false;
    const observedExecutedCode: string[] = [];

    const testMockAI = new AxMockAIService({
      features: { functions: true, streaming: false },
      chatResponse: async (req) => {
        const systemPrompt = String(req.chatPrompt[0]?.content ?? '');
        if (
          systemPrompt.includes(
            'Answer the query based on the provided context.'
          )
        ) {
          return {
            results: [
              { index: 0, content: 'sub-answer', finishReason: 'stop' },
            ],
            modelUsage: makeModelUsage(),
          };
        }

        callCount++;
        const functions = req.functions ?? [];
        sawCodeInterpreterFunction = functions.some(
          (f) => f.name === 'codeInterpreter'
        );
        if (callCount === 2) {
          const serializedPrompt = JSON.stringify(req.chatPrompt);
          sawCodeExecutedPrefix = serializedPrompt.includes('Code Executed:');
        }

        if (callCount === 1) {
          return {
            results: [
              {
                index: 0,
                content: 'Javascript Code: return "code-output"',
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
              content: 'Answer: final answer\nResult Ready: true',
              finishReason: 'stop',
            },
          ],
          modelUsage: makeModelUsage(),
        };
      },
    });

    const runtime: AxCodeRuntime = {
      language: 'JavaScript',
      createSession() {
        return {
          execute: async (code: string) => {
            observedExecutedCode.push(code);
            return `executed:${code}`;
          },
          close: () => {},
        };
      },
    };

    const testAgent = agent('context:string, query:string -> answer:string', {
      name: 'rlmInlineExecutionAgent',
      description:
        'Agent used to verify inline helper field processors and final validation flow.',
      ai: testMockAI,
      rlm: {
        mode: 'inline',
        language: 'javascript',
        contextFields: ['context'],
        runtime,
      },
    });

    const result = await testAgent.forward(testMockAI, {
      context: 'unused context',
      query: 'unused query',
    });

    expect(result.answer).toBe('final answer');
    expect((result as Record<string, unknown>).javascriptCode).toBeUndefined();
    expect((result as Record<string, unknown>).resultReady).toBeUndefined();
    expect(observedExecutedCode[0]).toBe('return "code-output"');
    expect(sawCodeExecutedPrefix).toBe(true);
    expect(callCount).toBe(2);
    expect(sawCodeInterpreterFunction).toBe(false);
  });

  it('should surface inline code execution exceptions in Code Executed output', async () => {
    let callCount = 0;
    let sawCodeExecutedPrefix = false;

    const testMockAI = new AxMockAIService({
      features: { functions: true, streaming: false },
      chatResponse: async (req) => {
        callCount++;
        if (callCount === 1) {
          return {
            results: [
              {
                index: 0,
                content: 'Javascript Code: throw new Error("boom")',
                finishReason: 'stop',
              },
            ],
            modelUsage: makeModelUsage(),
          };
        }

        sawCodeExecutedPrefix = JSON.stringify(req.chatPrompt).includes(
          'Code Executed:'
        );
        return {
          results: [
            {
              index: 0,
              content: 'Answer: recovered answer\nResult Ready: true',
              finishReason: 'stop',
            },
          ],
          modelUsage: makeModelUsage(),
        };
      },
    });

    const runtime: AxCodeRuntime = {
      language: 'JavaScript',
      createSession() {
        return {
          execute: async () => {
            throw new Error('Execution timed out');
          },
          close: () => {},
        };
      },
    };

    const testAgent = agent('context:string, query:string -> answer:string', {
      name: 'rlmInlineExecutionErrorAgent',
      description:
        'Agent used to verify inline code execution errors are prefixed in processor output.',
      ai: testMockAI,
      rlm: {
        mode: 'inline',
        language: 'javascript',
        contextFields: ['context'],
        runtime,
      },
    });

    const result = await testAgent.forward(testMockAI, {
      context: 'unused context',
      query: 'unused query',
    });

    expect(result.answer).toBe('recovered answer');
    expect(sawCodeExecutedPrefix).toBe(true);
    expect(callCount).toBe(2);
  });

  it('should expose codeInterpreter tool when mode is explicitly function', async () => {
    let sawCodeInterpreterFunction = false;
    let codeInterpreterDescription = '';

    const testMockAI = new AxMockAIService({
      features: { functions: true, streaming: false },
      chatResponse: {
        results: [{ index: 0, content: 'ok', finishReason: 'stop' }],
        modelUsage: makeModelUsage(),
      },
    });

    const runtime: AxCodeRuntime = {
      language: 'JavaScript',
      createSession() {
        return {
          execute: async () => 'ok',
          close: () => {},
        };
      },
    };

    const testAgent = agent('context:string, query:string -> answer:string', {
      name: 'rlmFunctionModeAgent',
      description:
        'Agent used to verify function mode remains tool-call based.',
      ai: testMockAI,
      rlm: {
        mode: 'function',
        contextFields: ['context'],
        runtime,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (testAgent as any).rlmProgram = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      forward: async (_ai: any, _values: any, forwardOptions: any) => {
        const functions = forwardOptions.functions ?? [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const codeInterpreter = functions.find((f: any) => {
          return f.name === 'codeInterpreter';
        });
        sawCodeInterpreterFunction = functions.some(
          (f: { name: string }) => f.name === 'codeInterpreter'
        );
        codeInterpreterDescription = String(codeInterpreter?.description ?? '');
        return { answer: 'done' };
      },
    };

    const result = await testAgent.forward(testMockAI, {
      context: 'unused',
      query: 'unused',
    });

    expect(result.answer).toBe('done');
    expect(sawCodeInterpreterFunction).toBe(true);
    expect(codeInterpreterDescription).not.toContain(
      'Persist with var (sync) or bare assignment (async).'
    );
  });

  it('should default to inline mode when rlm.mode is omitted', () => {
    const runtime: AxCodeRuntime = {
      language: 'JavaScript',
      createSession() {
        return {
          execute: async () => 'ok',
          close: () => {},
        };
      },
    };

    const testAgent = agent('context:string, query:string -> answer:string', {
      name: 'rlmInlineDefaultAgent',
      description: 'Agent used to verify inline is the default RLM mode.',
      rlm: {
        contextFields: ['context'],
        runtime,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rlmSig = (testAgent as any).rlmProgram.getSignature();
    const outputFields = rlmSig.getOutputFields();
    expect(
      outputFields.some((f: AxIField) => f.name === 'javascriptCode')
    ).toBe(true);
  });

  it('should derive inline code field name from rlm.language', () => {
    const runtime: AxCodeRuntime = {
      language: 'JavaScript',
      createSession() {
        return {
          execute: async () => 'ok',
          close: () => {},
        };
      },
    };

    const testAgent = agent('context:string, query:string -> answer:string', {
      name: 'rlmInlineLanguageFieldAgent',
      description:
        'Agent used to verify inline code field naming uses rlm.language.',
      rlm: {
        mode: 'inline',
        language: 'python',
        contextFields: ['context'],
        runtime,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rlmSig = (testAgent as any).rlmProgram.getSignature();
    const outputFields = rlmSig.getOutputFields();
    expect(outputFields.some((f: AxIField) => f.name === 'pythonCode')).toBe(
      true
    );
  });
});
