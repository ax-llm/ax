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

    it('should render with examples', () => {
      const signature = new AxSignature(
        'userQuery:string -> aiResponse:string "the result"'
      );
      const template = new AxPromptTemplate(signature);

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

    it('should handle zero in examples correctly', () => {
      const signature = new AxSignature(
        'query:string -> score:number, confidence:number'
      );
      const template = new AxPromptTemplate(signature);

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

    it('should handle false boolean values correctly in examples', () => {
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

      expect(result).toHaveLength(2);
      expect(result[0]?.role).toBe('system');
      const systemMessage = result[0] as
        | { role: 'system'; content: string }
        | undefined;
      expect(systemMessage?.content).toContain('Is User Message: false');
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
});
