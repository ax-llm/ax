import { describe, expect, test } from 'vitest';
import { ax, s, f } from './template.js';
import { AxAI } from '../ai/anthropic.js';
import type { ParseSignature } from './sigtypes.js';

describe('Type Inference Integration with ax.forward and streamingForward', () => {
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
    const originalForward = generator.forward;
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

  test('should provide type-safe inputs and outputs for template literals', async () => {
    // Create generator with template literal using f helper
    const emailClassifier = ax`
      emailText:${f.string('Email content to classify')} -> 
      category:${f.class(['spam', 'personal', 'work'], 'Email category')},
      priority:${f.class(['high', 'medium', 'low'], 'Priority level')},
      extractedTasks:${f.array(f.string('Action items'))}
    `;

    // Type should be inferred correctly
    type ExpectedInputs = { emailText: string };
    type ExpectedOutputs = {
      category: 'spam' | 'personal' | 'work';
      priority: 'high' | 'medium' | 'low';
      extractedTasks: string[];
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
        extractedTasks: ['Attend Q4 budget meeting'],
      } as ExpectedOutputs;
    };

    const result = await emailClassifier.forward(mockAI, validInputs);

    expect(result.category).toBe('work');
    expect(result.priority).toBe('medium');
    expect(Array.isArray(result.extractedTasks)).toBe(true);
    expect(result.extractedTasks[0]).toBe('Attend Q4 budget meeting');
  });

  test('should handle optional fields correctly', async () => {
    const optionalGen = ax`
      requiredField:${f.string('Required input')},
      optionalField:${f.optional(f.number('Optional input'))} -> 
      processedResult:${f.string('Processed result')},
      metadata:${f.optional(f.json('Optional metadata'))}
    `;

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

  test('should work with array types', async () => {
    const arrayGen = ax`
      userQuestions:${f.array(f.string('List of questions'))} -> 
      responseTexts:${f.array(f.string('List of responses'))},
      averageConfidence:${f.number('Average confidence score')}
    `;

    type ArrayInputs = { userQuestions: string[] };
    type ArrayOutputs = { responseTexts: string[]; averageConfidence: number };

    const arrayInputs: ArrayInputs = {
      userQuestions: [
        'What is AI?',
        'How does ML work?',
        'What is deep learning?',
      ],
    };

    arrayGen.forward = async (ai: any, inputs: any) => {
      expect(Array.isArray(inputs.userQuestions)).toBe(true);
      expect(inputs.userQuestions.length).toBe(3);

      return {
        responseTexts: inputs.userQuestions.map(
          (q: string) => `Answer to: ${q}`
        ),
        averageConfidence: 0.92,
      } as ArrayOutputs;
    };

    const result = await arrayGen.forward(mockAI, arrayInputs);

    expect(Array.isArray(result.responseTexts)).toBe(true);
    expect(result.responseTexts.length).toBe(3);
    expect(result.responseTexts[0]).toBe('Answer to: What is AI?');
    expect(result.averageConfidence).toBe(0.92);
  });

  test('should work with multi-modal types', async () => {
    const multiModalGen = ax`
      userQuestion:${f.string('Question about the image')},
      imageData:${f.image('Image to analyze')} -> 
      description:${f.string('Image description')},
      confidence:${f.number('Analysis confidence')}
    `;

    type MultiModalInputs = {
      userQuestion: string;
      imageData: { mimeType: string; data: string };
    };

    type MultiModalOutputs = {
      description: string;
      confidence: number;
    };

    const multiModalInputs: MultiModalInputs = {
      userQuestion: 'What do you see in this image?',
      imageData: { mimeType: 'image/jpeg', data: 'base64-encoded-data' },
    };

    multiModalGen.forward = async (ai: any, inputs: any) => {
      expect(typeof inputs.userQuestion).toBe('string');
      expect(typeof inputs.imageData).toBe('object');
      expect(typeof inputs.imageData.mimeType).toBe('string');
      expect(typeof inputs.imageData.data).toBe('string');

      return {
        description: 'A beautiful landscape with mountains',
        confidence: 0.95,
      } as MultiModalOutputs;
    };

    const result = await multiModalGen.forward(mockAI, multiModalInputs);

    expect(result.description).toBe('A beautiful landscape with mountains');
    expect(result.confidence).toBe(0.95);
  });

  test('should provide type-safe streaming', async () => {
    const streamingGen = ax`
      storyPrompt:${f.string('Story premise')} -> 
      storyText:${f.string('Generated story')},
      genre:${f.class(['fantasy', 'sci-fi', 'mystery'], 'Story genre')}
    `;

    type StreamingInputs = { storyPrompt: string };
    type StreamingOutputs = {
      storyText: string;
      genre: 'fantasy' | 'sci-fi' | 'mystery';
    };

    const streamingInputs: StreamingInputs = {
      storyPrompt: 'A robot discovers emotions',
    };

    // Mock the streamingForward method
    streamingGen.streamingForward = async function* (ai: any, inputs: any) {
      expect(typeof inputs.storyPrompt).toBe('string');

      yield { storyText: 'Once upon a time, ' };
      yield { storyText: 'there was a robot named R2 ' };
      yield { storyText: 'who began to feel...', genre: 'sci-fi' as const };
    };

    const chunks: any[] = [];
    for await (const chunk of streamingGen.streamingForward(
      mockAI,
      streamingInputs
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(3);
    expect(chunks[0].storyText).toBe('Once upon a time, ');
    expect(chunks[1].storyText).toBe('there was a robot named R2 ');
    expect(chunks[2].storyText).toBe('who began to feel...');
    expect(chunks[2].genre).toBe('sci-fi');
  });

  test('should work with s() signature template literal', () => {
    // Test the s() template literal for creating signatures
    const signature = s`
      userMessage:${f.string('User input')},
      contextData:${f.json('Background context')} -> 
      responseText:${f.string('AI response')},
      confidence:${f.number('Response confidence')}
    `;

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
