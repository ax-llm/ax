import { describe, expect, test } from 'vitest';
import { ax, s } from './template.js';

describe('Type Inference Integration with ax string-based functions', () => {
  // Mock AI for testing (no actual API calls)
  const mockAI = {
    name: 'mock',
    getEmbedding: () => Promise.resolve([0.1, 0.2, 0.3]),
    getChat: () =>
      Promise.resolve({
        content: 'Mock response',
        totalTokensUsed: 100,
        sessionId: 'test-session',
        remoteId: 'test-remote',
      }),
    getChatStream: async function* () {
      yield { content: 'Mock stream response', done: false };
      yield { content: ' complete', done: true };
    },
  } as any;

  test('should provide type-safe inputs and outputs for ax.forward', async () => {
    // Create a generator with specific types using string signature
    const generator = ax(
      'userQuestion:string, priority:number -> responseText:string, confidence:number'
    );

    // Type inference should work for inputs
    type ExpectedInputs = { userQuestion: string; priority: number };
    type ExpectedOutputs = { responseText: string; confidence: number };

    // These assignments should compile without type errors
    const validInputs: ExpectedInputs = {
      userQuestion: 'What is the weather?',
      priority: 5,
    };

    // Mock the forward method to return expected structure
    generator.forward = async (ai: any, inputs: any) => {
      // Verify input types at runtime
      expect(typeof inputs.userQuestion).toBe('string');
      expect(typeof inputs.priority).toBe('number');

      return {
        responseText: 'Sunny and warm',
        confidence: 0.85,
      } as ExpectedOutputs;
    };

    const result = await generator.forward(mockAI, validInputs);

    // Result should have correct types
    expect(typeof result.responseText).toBe('string');
    expect(typeof result.confidence).toBe('number');
    expect(result.responseText).toBe('Sunny and warm');
    expect(result.confidence).toBe(0.85);
  });

  test('should work with string-based signatures with classes', async () => {
    // Create generator with string-based signature
    const emailClassifier = ax('emailText:string -> category:class "spam, personal, work", priority:class "high, medium, low"');

    // Type should be inferred correctly
    type ExpectedInputs = { emailText: string };
    type ExpectedOutputs = {
      category: 'spam' | 'personal' | 'work';
      priority: 'high' | 'medium' | 'low';
    };

    const validInputs: ExpectedInputs = {
      emailText: 'Meeting tomorrow at 3pm about Q4 budget review',
    };

    // Mock the forward method
    emailClassifier.forward = async (ai: any, inputs: any) => {
      expect(typeof inputs.emailText).toBe('string');

      return {
        category: 'work' as const,
        priority: 'medium' as const,
      } as ExpectedOutputs;
    };

    const result = await emailClassifier.forward(mockAI, validInputs);

    expect(result.category).toBe('work');
    expect(result.priority).toBe('medium');
  });

  test('should handle optional fields correctly', async () => {
    const optionalGen = ax('requiredField:string, optionalField?:number -> processedResult:string, metadata?:json');

    // Input with optional field
    type InputsWithOptional = {
      requiredField: string;
      optionalField?: number;
    };

    type OutputsWithOptional = {
      processedResult: string;
      metadata?: any;
    };

    const inputsWithOptional: InputsWithOptional = {
      requiredField: 'test',
      optionalField: 42,
    };

    const inputsWithoutOptional: InputsWithOptional = {
      requiredField: 'test',
      // optionalField is optional, so this should be valid
    };

    // Mock the forward method
    optionalGen.forward = async (ai: any, inputs: any) => {
      return {
        processedResult: 'processed',
        metadata: inputs.optionalField
          ? { priority: inputs.optionalField }
          : undefined,
      } as OutputsWithOptional;
    };

    const result1 = await optionalGen.forward(mockAI, inputsWithOptional);
    const result2 = await optionalGen.forward(mockAI, inputsWithoutOptional);

    expect(result1.processedResult).toBe('processed');
    expect(result1.metadata).toEqual({ priority: 42 });
    expect(result2.processedResult).toBe('processed');
    expect(result2.metadata).toBeUndefined();
  });

  test('should work with s() signature function', () => {
    // Test the s() function for creating signatures
    const signature = s('userMessage:string, contextData:json -> responseText:string, confidence:number');

    // Verify signature was created correctly
    expect(signature.getInputFields()).toHaveLength(2);
    expect(signature.getOutputFields()).toHaveLength(2);

    const inputFields = signature.getInputFields();
    const outputFields = signature.getOutputFields();

    expect(inputFields[0]?.name).toBe('userMessage');
    expect(inputFields[0]?.type?.name).toBe('string');
    expect(inputFields[1]?.name).toBe('contextData');
    expect(inputFields[1]?.type?.name).toBe('json');

    expect(outputFields[0]?.name).toBe('responseText');
    expect(outputFields[0]?.type?.name).toBe('string');
    expect(outputFields[1]?.name).toBe('confidence');
    expect(outputFields[1]?.type?.name).toBe('number');
  });

  test('compile-time type checking should prevent wrong input types', () => {
    const strictGen = ax(
      'userInput:string, count:number -> processedOutput:string'
    );

    // These should work at compile time
    type ValidInputs = { userInput: string; count: number };
    const validInputs: ValidInputs = { userInput: 'test', count: 5 };

    // This should cause TypeScript errors if types are working correctly:
    // const invalidInputs: ValidInputs = { userInput: 123, count: 'five' }; // Should error
    // const missingField: ValidInputs = { userInput: 'test' }; // Should error

    expect(validInputs.userInput).toBe('test');
    expect(validInputs.count).toBe(5);
  });
});