import { describe, expect, it } from 'vitest';

import { AxPromptTemplate } from './prompt.js';
import { AxSignature } from './sig.js';
import type { AxMessage } from './types.js';

// Helper to create a basic signature
const createSignature = (desc: string) => {
  return new AxSignature(desc);
};

const defaultSig = createSignature('userQuery:string -> aiResponse:string');

const multiFieldSig = createSignature(
  'userQuestion:string, contextInfo:string -> assistantAnswer:string'
);

// Signature for testing assistant message rendering logic
const assistantTestSig = createSignature(
  'userMessage:string -> thoughtProcess:string "Thought process", mainResponse:string "Main output", optionalResponse?:string "Optional output", internalThoughts!:string "Internal output"'
);

describe('AxPromptTemplate.render', () => {
  type TestExpectedMessage = { role: 'user' | 'assistant'; content: string };

  describe('Single AxGenIn input (existing behavior)', () => {
    it('should render a basic prompt with single AxGenIn', () => {
      const signature = new AxSignature(
        'userQuery:string -> aiResponse:string "the result"'
      );
      const template = new AxPromptTemplate(signature);

      const result = template.render({ userQuery: 'test' }, {});

      expect(result).toHaveLength(2);
      expect(result[0]?.role).toBe('system');
      expect(result[1]?.role).toBe('user');
      const userMessage = result[1] as TestExpectedMessage | undefined;
      expect(userMessage?.content).toContain('User Query: test');
    });

    it('should render with examples (legacy: examplesInSystem)', () => {
      const signature = new AxSignature(
        'userQuery:string -> aiResponse:string "the result"'
      );
      const template = new AxPromptTemplate(signature, {
        examplesInSystem: true,
      });

      const examples = [{ userQuery: 'hello', aiResponse: 'world' }];
      const result = template.render({ userQuery: 'test' }, { examples });

      expect(result).toHaveLength(2);
      expect(result[0]?.role).toBe('system');
      const systemMessage = result[0] as
        | { role: 'system'; content: string }
        | undefined;
      expect(systemMessage?.content).toContain('User Query: hello');
      expect(systemMessage?.content).toContain('Ai Response: world');
    });

    it('should render with examples as message pairs by default', () => {
      const signature = new AxSignature(
        'userQuery:string -> aiResponse:string "the result"'
      );
      const template = new AxPromptTemplate(signature);

      const examples = [{ userQuery: 'hello', aiResponse: 'world' }];
      const result = template.render({ userQuery: 'test' }, { examples });

      // Should have: system, user (example), assistant (example), user (query)
      expect(result).toHaveLength(4);
      expect(result[0]?.role).toBe('system');
      expect(result[1]?.role).toBe('user');
      expect(result[2]?.role).toBe('assistant');
      expect(result[3]?.role).toBe('user');

      // System prompt should NOT contain example content
      const systemMessage = result[0] as
        | { role: 'system'; content: string }
        | undefined;
      expect(systemMessage?.content).not.toContain('hello');
      expect(systemMessage?.content).not.toContain('world');

      // Example user message should contain input
      const exampleUser = result[1] as { role: 'user'; content: string };
      expect(exampleUser.content).toContain('User Query: hello');

      // Example assistant message should contain output
      const exampleAssistant = result[2] as {
        role: 'assistant';
        content: string;
      };
      expect(exampleAssistant.content).toContain('Ai Response: world');

      // Final user message should contain actual query
      const actualUser = result[3] as { role: 'user'; content: string };
      expect(actualUser.content).toContain('User Query: test');
    });
  });

  describe('number fields with zero values', () => {
    it('should handle zero values correctly for number fields', () => {
      const signature = new AxSignature(
        'query:string, priority:number -> responseText:string, score:number'
      );
      const template = new AxPromptTemplate(signature);

      const result = template.render({ query: 'test', priority: 0 }, {});

      expect(result).toHaveLength(2);
      expect(result[1]?.role).toBe('user');
      const userMessage = result[1] as { role: 'user'; content: string };
      expect(userMessage?.content).toContain('Priority: 0');
    });

    it('should handle zero in examples correctly (legacy: examplesInSystem)', () => {
      const signature = new AxSignature(
        'query:string -> score:number, confidence:number'
      );
      const template = new AxPromptTemplate(signature, {
        examplesInSystem: true,
      });

      const examples = [{ query: 'test', score: 0, confidence: 0.5 }];

      const result = template.render({ query: 'hello' }, { examples });

      expect(result).toHaveLength(2);
      expect(result[0]?.role).toBe('system');
      const systemMessage = result[0] as
        | { role: 'system'; content: string }
        | undefined;
      expect(systemMessage?.content).toContain('Score: 0');
      expect(systemMessage?.content).toContain('Confidence: 0.5');
    });

    it('should handle zero in examples correctly (message pairs)', () => {
      const signature = new AxSignature(
        'query:string -> score:number, confidence:number'
      );
      const template = new AxPromptTemplate(signature);

      const examples = [{ query: 'test', score: 0, confidence: 0.5 }];

      const result = template.render({ query: 'hello' }, { examples });

      // Should have: system, user (example), assistant (example), user (query)
      expect(result).toHaveLength(4);
      expect(result[2]?.role).toBe('assistant');
      const assistantMessage = result[2] as {
        role: 'assistant';
        content: string;
      };
      expect(assistantMessage.content).toContain('Score: 0');
      expect(assistantMessage.content).toContain('Confidence: 0.5');
    });

    it('should handle negative numbers and special numeric values', () => {
      const signature = new AxSignature(
        'query:string, offset:number -> processedText:string'
      );
      const template = new AxPromptTemplate(signature);

      const result = template.render({ query: 'test', offset: -1 }, {});

      expect(result).toHaveLength(2);
      const userMessage = result[1] as { role: 'user'; content: string };
      expect(userMessage?.content).toContain('Offset: -1');
    });
  });

  describe('examples with missing fields', () => {
    it('should allow missing input fields in examples', () => {
      const signature = new AxSignature(
        'userQuery:string, isUserMessage:boolean -> aiResponse:string'
      );
      const template = new AxPromptTemplate(signature);

      const examples = [{ userQuery: 'hello', aiResponse: 'world' }]; // missing isUserMessage

      expect(() => {
        template.render(
          { userQuery: 'test', isUserMessage: true },
          { examples }
        );
      }).not.toThrow();
    });

    it('should handle false boolean values correctly in examples (legacy: examplesInSystem)', () => {
      const signature = new AxSignature(
        'userQuery:string, isUserMessage:boolean -> aiResponse:string'
      );
      const template = new AxPromptTemplate(signature, {
        examplesInSystem: true,
      });

      const examples = [
        { userQuery: 'hello', isUserMessage: false, aiResponse: 'world' },
      ];

      const result = template.render(
        { userQuery: 'test', isUserMessage: true },
        { examples }
      );

      expect(result).toHaveLength(2);
      expect(result[0]?.role).toBe('system');
      const systemMessage = result[0] as
        | { role: 'system'; content: string }
        | undefined;
      expect(systemMessage?.content).toContain('Is User Message: false');
    });

    it('should handle false boolean values correctly in examples (message pairs)', () => {
      const signature = new AxSignature(
        'userQuery:string, isUserMessage:boolean -> aiResponse:string'
      );
      const template = new AxPromptTemplate(signature);

      const examples = [
        { userQuery: 'hello', isUserMessage: false, aiResponse: 'world' },
      ];

      const result = template.render(
        { userQuery: 'test', isUserMessage: true },
        { examples }
      );

      // Should have: system, user (example), assistant (example), user (query)
      expect(result).toHaveLength(4);
      const exampleUser = result[1] as { role: 'user'; content: string };
      expect(exampleUser.content).toContain('Is User Message: false');
    });

    it('should allow missing output fields in examples', () => {
      const signature = new AxSignature(
        'userQuery:string -> aiResponse:string, categoryType:string'
      );
      const template = new AxPromptTemplate(signature);

      const examples = [{ userQuery: 'hello', aiResponse: 'world' }]; // missing category output field

      expect(() => {
        template.render({ userQuery: 'test' }, { examples });
      }).not.toThrow();
    });

    it('should skip examples with all input fields missing (message pairs)', () => {
      const signature = new AxSignature(
        'userQuery:string -> aiResponse:string'
      );
      const template = new AxPromptTemplate(signature);

      // Example with only output field, no input - should be skipped
      const examples = [{ aiResponse: 'world' }];

      const result = template.render({ userQuery: 'test' }, { examples });

      // Should only have: system, user (query) - no example messages
      expect(result).toHaveLength(2);
      expect(result[0]?.role).toBe('system');
      expect(result[1]?.role).toBe('user');
    });

    it('should skip examples with all output fields missing (message pairs)', () => {
      const signature = new AxSignature(
        'userQuery:string -> aiResponse:string'
      );
      const template = new AxPromptTemplate(signature);

      // Example with only input field, no output - should be skipped
      const examples = [{ userQuery: 'hello' }];

      const result = template.render({ userQuery: 'test' }, { examples });

      // Should only have: system, user (query) - no example messages
      expect(result).toHaveLength(2);
      expect(result[0]?.role).toBe('system');
      expect(result[1]?.role).toBe('user');
    });

    it('should include valid examples and skip invalid ones (message pairs)', () => {
      const signature = new AxSignature(
        'userQuery:string -> aiResponse:string'
      );
      const template = new AxPromptTemplate(signature);

      // Mix of valid and invalid examples
      const examples = [
        { userQuery: 'hello', aiResponse: 'world' }, // valid
        { aiResponse: 'orphan' }, // invalid - no input
        { userQuery: 'goodbye', aiResponse: 'farewell' }, // valid
      ];

      const result = template.render({ userQuery: 'test' }, { examples });

      // Should have: system, 2x(user + assistant for valid examples), user (query)
      expect(result).toHaveLength(6);
      expect(result[0]?.role).toBe('system');
      expect(result[1]?.role).toBe('user');
      expect(result[2]?.role).toBe('assistant');
      expect(result[3]?.role).toBe('user');
      expect(result[4]?.role).toBe('assistant');
      expect(result[5]?.role).toBe('user');

      // Verify the valid examples are present
      const firstExampleUser = result[1] as { role: 'user'; content: string };
      expect(firstExampleUser.content).toContain('hello');

      const secondExampleUser = result[3] as { role: 'user'; content: string };
      expect(secondExampleUser.content).toContain('goodbye');
    });
  });

  describe('ReadonlyArray<AxMessage> input (new behavior)', () => {
    it('should render with a single user message in history', () => {
      const pt = new AxPromptTemplate(defaultSig);
      const history: ReadonlyArray<AxMessage<{ userQuery: string }>> = [
        { role: 'user', values: { userQuery: 'first message' } },
      ];
      const result = pt.render(history, {});

      expect(result.length).toBe(2);
      expect(result[0]?.role).toBe('system');
      const userMessage = result[1] as TestExpectedMessage | undefined;
      expect(userMessage?.role).toBe('user');
      expect(userMessage?.content).toBe('User Query: first message\n');
    });

    it('should combine consecutive user messages', () => {
      const pt = new AxPromptTemplate(multiFieldSig);
      const history: ReadonlyArray<
        AxMessage<{ userQuestion: string; contextInfo: string }>
      > = [
        { role: 'user', values: { userQuestion: 'q1', contextInfo: 'c1' } },
        { role: 'user', values: { userQuestion: 'q2', contextInfo: 'c2' } },
      ];
      const result = pt.render(history, {});

      expect(result.length).toBe(3);
      const userMessage = result[1] as TestExpectedMessage | undefined;
      expect(userMessage?.role).toBe('user');
      expect(userMessage?.content).toBe(
        'User Question: q1\n\nContext Info: c1\n'
      );
    });

    it('should handle alternating user and assistant messages', () => {
      const pt = new AxPromptTemplate(multiFieldSig);
      const history: ReadonlyArray<
        AxMessage<{ userQuestion: string; contextInfo: string }>
      > = [
        { role: 'user', values: { userQuestion: 'q1', contextInfo: 'c1' } },
        {
          role: 'assistant',
          values: { userQuestion: 'q1-followup', contextInfo: 'c1-response' },
        },
        { role: 'user', values: { userQuestion: 'q2', contextInfo: 'c2' } },
      ];
      const result = pt.render(history, {});

      expect(result.length).toBe(4);
      expect(result[0]?.role).toBe('system');
      const userMessage1 = result[1] as TestExpectedMessage | undefined;
      expect(userMessage1?.role).toBe('user');
      expect(userMessage1?.content).toBe(
        'User Question: q1\n\nContext Info: c1\n'
      );
      const assistantMessage = result[2] as TestExpectedMessage | undefined;
      expect(assistantMessage?.role).toBe('assistant');
      expect(assistantMessage?.content).toBe(
        'User Question: q1-followup\n\nContext Info: c1-response\n'
      );
      const userMessage2 = result[3] as TestExpectedMessage | undefined;
      expect(userMessage2?.role).toBe('user');
      expect(userMessage2?.content).toBe(
        'User Question: q2\n\nContext Info: c2\n'
      );
    });

    // This test confirms user messages need all required fields
    it('should throw if required field missing in user message history', () => {
      const pt = new AxPromptTemplate(multiFieldSig);
      const history: ReadonlyArray<
        AxMessage<{ userQuestion: string; contextInfo?: string }>
      > = [
        { role: 'user', values: { userQuestion: 'q1' } }, // contextInfo is missing
      ];
      expect(() => pt.render(history, {})).toThrowError(
        "Value for input field 'contextInfo' is required."
      );
    });

    it('should handle empty history array', () => {
      const pt = new AxPromptTemplate(defaultSig);
      const history: ReadonlyArray<AxMessage<{ userQuery: string }>> = [];
      const result = pt.render(history, {});

      expect(result.length).toBe(1); // Only system prompt for empty array
      expect(result[0]?.role).toBe('system');
      // If an empty history array resulted in an empty user message, this would be:
      // expect(result.length).toBe(2);
      // const userMessage = result[1] as TestExpectedMessage | undefined;
      // expect(userMessage?.role).toBe('user');
      // expect(userMessage?.content).toBe('');
    });

    describe('Assistant Messages in History', () => {
      it('should render assistant message with input fields', () => {
        const pt = new AxPromptTemplate(assistantTestSig);
        const history: ReadonlyArray<AxMessage<{ userMessage: string }>> = [
          {
            role: 'assistant',
            values: {
              userMessage: 'assistant input value',
            },
          },
        ];
        const result = pt.render(history, {});
        expect(result.length).toBe(2);
        const assistantMsg = result[1] as TestExpectedMessage | undefined;
        expect(assistantMsg?.role).toBe('assistant');
        expect(assistantMsg?.content).toBe(
          'User Message: assistant input value\n'
        );
      });

      it('should throw error if required input field is missing in assistant message', () => {
        const pt = new AxPromptTemplate(assistantTestSig);
        const history: ReadonlyArray<AxMessage<{ userMessage?: string }>> = [
          {
            role: 'assistant',
            values: {}, // 'userMessage' is missing
          },
        ];
        expect(() => pt.render(history, {})).toThrowError(
          "Value for input field 'userMessage' is required."
        );
      });

      it('should render assistant message with multiple input fields', () => {
        const pt = new AxPromptTemplate(multiFieldSig);
        const history: ReadonlyArray<
          AxMessage<{ userQuestion: string; contextInfo: string }>
        > = [
          {
            role: 'assistant',
            values: {
              userQuestion: 'What is the answer?',
              contextInfo: 'This is the context',
            },
          },
        ];
        const result = pt.render(history, {});
        expect(result.length).toBe(2);
        const assistantMsg = result[1] as TestExpectedMessage | undefined;
        expect(assistantMsg?.role).toBe('assistant');
        expect(assistantMsg?.content).toBe(
          'User Question: What is the answer?\n\nContext Info: This is the context\n'
        );
      });

      it('should throw error if required input field is missing in multi-field assistant message', () => {
        const pt = new AxPromptTemplate(multiFieldSig);
        const history: ReadonlyArray<
          AxMessage<{ userQuestion: string; contextInfo?: string }>
        > = [
          {
            role: 'assistant',
            values: {
              userQuestion: 'What is the answer?',
              // contextInfo is missing
            },
          },
        ];
        expect(() => pt.render(history, {})).toThrowError(
          "Value for input field 'contextInfo' is required."
        );
      });
    });
  });

  describe('File field handling', () => {
    it('should render file field with data (base64)', () => {
      const sig = new AxSignature('fileInput:file -> responseText:string');
      const pt = new AxPromptTemplate(sig);

      const result = pt.render(
        {
          fileInput: {
            mimeType: 'application/pdf',
            data: 'base64data',
          },
        },
        {}
      );

      expect(result).toHaveLength(2); // system + user message

      // Check user message
      const userMessage = result.find((m) => m.role === 'user');
      expect(userMessage).toBeDefined();
      expect(userMessage!.content).toHaveLength(2);
      expect(userMessage!.content[0]).toEqual({
        type: 'text',
        text: 'File Input: \n',
      });
      expect(userMessage!.content[1]).toEqual({
        type: 'file',
        mimeType: 'application/pdf',
        data: 'base64data',
      });
    });

    it('should render file field with fileUri (gs:// URL)', () => {
      const sig = new AxSignature('fileInput:file -> responseText:string');
      const pt = new AxPromptTemplate(sig);

      const result = pt.render(
        {
          fileInput: {
            mimeType: 'application/pdf',
            fileUri: 'gs://my-bucket/test.pdf',
          },
        },
        {}
      );

      expect(result).toHaveLength(2); // system + user message

      // Check user message
      const userMessage = result.find((m) => m.role === 'user');
      expect(userMessage).toBeDefined();
      expect(userMessage!.content).toHaveLength(2);
      expect(userMessage!.content[0]).toEqual({
        type: 'text',
        text: 'File Input: \n',
      });
      expect(userMessage!.content[1]).toEqual({
        type: 'file',
        mimeType: 'application/pdf',
        fileUri: 'gs://my-bucket/test.pdf',
      });
    });

    it('should render array of files with mixed formats', () => {
      const sig = new AxSignature('fileInputs:file[] -> responseText:string');
      const pt = new AxPromptTemplate(sig);

      const result = pt.render(
        {
          fileInputs: [
            {
              mimeType: 'application/pdf',
              data: 'base64data1',
            },
            {
              mimeType: 'application/pdf',
              fileUri: 'gs://my-bucket/doc2.pdf',
            },
          ],
        },
        {}
      );

      expect(result).toHaveLength(2); // system + user message

      // Check user message
      const userMessage = result.find((m) => m.role === 'user');
      expect(userMessage).toBeDefined();
      expect(userMessage!.content).toHaveLength(3);

      // Text prefix
      expect(userMessage!.content[0]).toEqual({
        type: 'text',
        text: 'File Inputs: \n',
      });

      // First file with data
      expect(userMessage!.content[1]).toEqual({
        type: 'file',
        mimeType: 'application/pdf',
        data: 'base64data1',
      });

      // Second file with fileUri
      expect(userMessage!.content[2]).toEqual({
        type: 'file',
        mimeType: 'application/pdf',
        fileUri: 'gs://my-bucket/doc2.pdf',
      });
    });

    it('should validate file field requirements', () => {
      const sig = new AxSignature('fileInput:file -> responseText:string');
      const pt = new AxPromptTemplate(sig);

      // Missing mimeType
      expect(() =>
        pt.render(
          {
            fileInput: {
              data: 'base64data',
            },
          },
          {}
        )
      ).toThrow(/mimeType.*data.*fileUri/);

      // Missing both data and fileUri
      expect(() =>
        pt.render(
          {
            fileInput: {
              mimeType: 'application/pdf',
            },
          },
          {}
        )
      ).toThrow(/mimeType.*data.*fileUri/);

      // Both data and fileUri present
      expect(() =>
        pt.render(
          {
            fileInput: {
              mimeType: 'application/pdf',
              data: 'base64data',
              fileUri: 'gs://my-bucket/test.pdf',
            },
          },
          {}
        )
      ).toThrow(/mimeType.*data.*fileUri/);
    });
  });

  describe('Examples as alternating message pairs (new default behavior)', () => {
    it('should render multiple examples as alternating user/assistant pairs', () => {
      const signature = new AxSignature(
        'userQuery:string -> aiResponse:string'
      );
      const template = new AxPromptTemplate(signature);

      const examples = [
        { userQuery: 'hello', aiResponse: 'world' },
        { userQuery: 'foo', aiResponse: 'bar' },
      ];
      const result = template.render({ userQuery: 'test' }, { examples });

      // Should have: system, user (ex1), assistant (ex1), user (ex2), assistant (ex2), user (query)
      expect(result).toHaveLength(6);
      expect(result[0]?.role).toBe('system');
      expect(result[1]?.role).toBe('user');
      expect(result[2]?.role).toBe('assistant');
      expect(result[3]?.role).toBe('user');
      expect(result[4]?.role).toBe('assistant');
      expect(result[5]?.role).toBe('user');

      // Check example content
      const ex1User = result[1] as { role: 'user'; content: string };
      const ex1Asst = result[2] as { role: 'assistant'; content: string };
      const ex2User = result[3] as { role: 'user'; content: string };
      const ex2Asst = result[4] as { role: 'assistant'; content: string };

      expect(ex1User.content).toContain('User Query: hello');
      expect(ex1Asst.content).toContain('Ai Response: world');
      expect(ex2User.content).toContain('User Query: foo');
      expect(ex2Asst.content).toContain('Ai Response: bar');
    });

    it('should render demos as alternating user/assistant pairs', () => {
      const signature = new AxSignature(
        'userQuery:string -> aiResponse:string'
      );
      const template = new AxPromptTemplate(signature);

      const demos = [{ userQuery: 'demo input', aiResponse: 'demo output' }];
      const result = template.render({ userQuery: 'test' }, { demos });

      // Should have: system, user (demo), assistant (demo), user (query)
      expect(result).toHaveLength(4);
      expect(result[0]?.role).toBe('system');
      expect(result[1]?.role).toBe('user');
      expect(result[2]?.role).toBe('assistant');
      expect(result[3]?.role).toBe('user');

      // Check demo content
      const demoUser = result[1] as { role: 'user'; content: string };
      const demoAsst = result[2] as { role: 'assistant'; content: string };

      expect(demoUser.content).toContain('User Query: demo input');
      expect(demoAsst.content).toContain('Ai Response: demo output');
    });

    it('should render examples and demos in correct order', () => {
      const signature = new AxSignature(
        'userQuery:string -> aiResponse:string'
      );
      const template = new AxPromptTemplate(signature);

      const examples = [{ userQuery: 'example', aiResponse: 'example out' }];
      const demos = [{ userQuery: 'demo', aiResponse: 'demo out' }];
      const result = template.render(
        { userQuery: 'test' },
        { examples, demos }
      );

      // Should have: system, user (ex), assistant (ex), user (demo), assistant (demo), user (query)
      expect(result).toHaveLength(6);

      // Examples come first
      const exUser = result[1] as { role: 'user'; content: string };
      const exAsst = result[2] as { role: 'assistant'; content: string };
      expect(exUser.content).toContain('User Query: example');
      expect(exAsst.content).toContain('Ai Response: example out');

      // Then demos
      const demoUser = result[3] as { role: 'user'; content: string };
      const demoAsst = result[4] as { role: 'assistant'; content: string };
      expect(demoUser.content).toContain('User Query: demo');
      expect(demoAsst.content).toContain('Ai Response: demo out');
    });

    it('should handle multimodal examples as message pairs', () => {
      const signature = new AxSignature(
        'imageInput:image -> description:string'
      );
      const template = new AxPromptTemplate(signature);

      const examples = [
        {
          imageInput: { mimeType: 'image/png', data: 'base64ImageData' },
          description: 'A beautiful sunset',
        },
      ];
      const result = template.render(
        { imageInput: { mimeType: 'image/png', data: 'testImage' } },
        { examples }
      );

      // Should have: system, user (example with image), assistant (example), user (query with image)
      expect(result).toHaveLength(4);
      expect(result[0]?.role).toBe('system');
      expect(result[1]?.role).toBe('user');
      expect(result[2]?.role).toBe('assistant');
      expect(result[3]?.role).toBe('user');

      // Example user message should have multimodal content
      const exUser = result[1] as {
        role: 'user';
        content: unknown[];
      };
      expect(Array.isArray(exUser.content)).toBe(true);
      expect(exUser.content.some((c: any) => c.type === 'image')).toBe(true);

      // Example assistant message should be text
      const exAsst = result[2] as { role: 'assistant'; content: string };
      expect(exAsst.content).toContain('Description: A beautiful sunset');
    });

    it('should apply cache to last assistant demo message when contextCache is enabled', () => {
      const signature = new AxSignature(
        'userQuery:string -> aiResponse:string'
      );
      const template = new AxPromptTemplate(signature, {
        contextCache: { ttlSeconds: 3600 },
      });

      const examples = [{ userQuery: 'hello', aiResponse: 'world' }];
      const result = template.render({ userQuery: 'test' }, { examples });

      // System should have cache flag
      const systemMsg = result[0] as { role: 'system'; cache?: boolean };
      expect(systemMsg.cache).toBe(true);

      // Last assistant demo should have cache flag
      const lastDemo = result[2] as { role: 'assistant'; cache?: boolean };
      expect(lastDemo.cache).toBe(true);

      // User query should NOT have cache flag
      const userQuery = result[3] as { role: 'user'; cache?: boolean };
      expect(userQuery.cache).toBeUndefined();
    });

    it('should work with multi-turn history and examples', () => {
      const signature = new AxSignature(
        'userQuery:string -> aiResponse:string'
      );
      const template = new AxPromptTemplate(signature);

      const examples = [{ userQuery: 'example', aiResponse: 'example out' }];
      const history: ReadonlyArray<AxMessage<{ userQuery: string }>> = [
        { role: 'user', values: { userQuery: 'first message' } },
        { role: 'assistant', values: { userQuery: 'first response' } },
        { role: 'user', values: { userQuery: 'second message' } },
      ];

      const result = template.render(history, { examples });

      // Should have: system, user (ex), assistant (ex), user (hist1), assistant (hist1), user (hist2)
      expect(result).toHaveLength(6);
      expect(result[0]?.role).toBe('system');

      // Example messages
      expect(result[1]?.role).toBe('user');
      expect(result[2]?.role).toBe('assistant');
      const exUser = result[1] as { role: 'user'; content: string };
      expect(exUser.content).toContain('User Query: example');

      // History messages
      expect(result[3]?.role).toBe('user');
      expect(result[4]?.role).toBe('assistant');
      expect(result[5]?.role).toBe('user');
      const histUser1 = result[3] as { role: 'user'; content: string };
      const histUser2 = result[5] as { role: 'user'; content: string };
      expect(histUser1.content).toContain('User Query: first message');
      expect(histUser2.content).toContain('User Query: second message');
    });

    it('should render without examples when none provided', () => {
      const signature = new AxSignature(
        'userQuery:string -> aiResponse:string'
      );
      const template = new AxPromptTemplate(signature);

      const result = template.render({ userQuery: 'test' }, {});

      // Should have: system, user (query)
      expect(result).toHaveLength(2);
      expect(result[0]?.role).toBe('system');
      expect(result[1]?.role).toBe('user');
    });
  });

  describe('Example disclaimer and separator', () => {
    it('should add disclaimer to system prompt when examples exist', () => {
      const signature = new AxSignature(
        'userQuery:string -> aiResponse:string'
      );
      const template = new AxPromptTemplate(signature);

      const examples = [{ userQuery: 'hello', aiResponse: 'world' }];
      const result = template.render({ userQuery: 'test' }, { examples });

      const systemMessage = result[0] as { role: 'system'; content: string };
      expect(systemMessage.content).toContain('## Example Demonstrations');
      expect(systemMessage.content).toContain('few-shot examples');
      expect(systemMessage.content).toContain(
        'The actual task begins with the final User message.'
      );
    });

    it('should add separator before final user message when examples exist', () => {
      const signature = new AxSignature(
        'userQuery:string -> aiResponse:string'
      );
      const template = new AxPromptTemplate(signature);

      const examples = [{ userQuery: 'hello', aiResponse: 'world' }];
      const result = template.render({ userQuery: 'test' }, { examples });

      // Final user message should have separator prepended
      const finalUserMessage = result[result.length - 1] as {
        role: 'user';
        content: string;
      };
      expect(finalUserMessage.content).toContain('--- END OF EXAMPLES ---');
      expect(finalUserMessage.content).toContain('REAL USER QUERY:');
      expect(finalUserMessage.content).toContain('User Query: test');
    });

    it('should NOT add disclaimer/separator when no examples exist', () => {
      const signature = new AxSignature(
        'userQuery:string -> aiResponse:string'
      );
      const template = new AxPromptTemplate(signature);

      const result = template.render({ userQuery: 'test' }, {});

      const systemMessage = result[0] as { role: 'system'; content: string };
      expect(systemMessage.content).not.toContain('## Example Demonstrations');

      const userMessage = result[1] as { role: 'user'; content: string };
      expect(userMessage.content).not.toContain('--- END OF EXAMPLES ---');
      expect(userMessage.content).toBe('User Query: test\n');
    });

    it('should add disclaimer/separator when demos exist (not just examples)', () => {
      const signature = new AxSignature(
        'userQuery:string -> aiResponse:string'
      );
      const template = new AxPromptTemplate(signature);

      const demos = [{ userQuery: 'demo', aiResponse: 'demo out' }];
      const result = template.render({ userQuery: 'test' }, { demos });

      const systemMessage = result[0] as { role: 'system'; content: string };
      expect(systemMessage.content).toContain('## Example Demonstrations');

      const finalUserMessage = result[result.length - 1] as {
        role: 'user';
        content: string;
      };
      expect(finalUserMessage.content).toContain('--- END OF EXAMPLES ---');
    });

    it('should add separator only to first user message in multi-turn history', () => {
      const signature = new AxSignature(
        'userQuery:string -> aiResponse:string'
      );
      const template = new AxPromptTemplate(signature);

      const examples = [{ userQuery: 'example', aiResponse: 'example out' }];
      const history: ReadonlyArray<AxMessage<{ userQuery: string }>> = [
        { role: 'user', values: { userQuery: 'first message' } },
        { role: 'assistant', values: { userQuery: 'first response' } },
        { role: 'user', values: { userQuery: 'second message' } },
      ];

      const result = template.render(history, { examples });

      // First history user message should have separator
      const histUser1 = result[3] as { role: 'user'; content: string };
      expect(histUser1.content).toContain('--- END OF EXAMPLES ---');
      expect(histUser1.content).toContain('first message');

      // Second history user message should NOT have separator
      const histUser2 = result[5] as { role: 'user'; content: string };
      expect(histUser2.content).not.toContain('--- END OF EXAMPLES ---');
      expect(histUser2.content).toContain('second message');
    });

    it('should NOT add disclaimer/separator when examples array is empty', () => {
      const signature = new AxSignature(
        'userQuery:string -> aiResponse:string'
      );
      const template = new AxPromptTemplate(signature);

      const result = template.render({ userQuery: 'test' }, { examples: [] });

      const systemMessage = result[0] as { role: 'system'; content: string };
      expect(systemMessage.content).not.toContain('## Example Demonstrations');

      const userMessage = result[1] as { role: 'user'; content: string };
      expect(userMessage.content).not.toContain('--- END OF EXAMPLES ---');
    });

    it('should NOT add disclaimer/separator when examplesInSystem is true (legacy mode)', () => {
      const signature = new AxSignature(
        'userQuery:string -> aiResponse:string'
      );
      const template = new AxPromptTemplate(signature, {
        examplesInSystem: true,
      });

      const examples = [{ userQuery: 'hello', aiResponse: 'world' }];
      const result = template.render({ userQuery: 'test' }, { examples });

      // In legacy mode, examples are in system prompt but WITHOUT the disclaimer
      const systemMessage = result[0] as { role: 'system'; content: string };
      expect(systemMessage.content).not.toContain('## Example Demonstrations');
      expect(systemMessage.content).not.toContain('few-shot examples');
      // But should still contain the example content
      expect(systemMessage.content).toContain('User Query: hello');
      expect(systemMessage.content).toContain('Ai Response: world');

      // User message should NOT have separator
      const userMessage = result[1] as { role: 'user'; content: string };
      expect(userMessage.content).not.toContain('--- END OF EXAMPLES ---');
      expect(userMessage.content).not.toContain('REAL USER QUERY:');
      expect(userMessage.content).toContain('User Query: test');
    });
  });
});
