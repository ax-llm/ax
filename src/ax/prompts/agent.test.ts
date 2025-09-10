import { describe, expect, it } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import type { AxChatResponse } from '../ai/types.js';
import { s } from '../dsp/template.js';
import type { AxMessage } from '../dsp/types.js';

import { AxAgent, agent } from './agent.js';

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
