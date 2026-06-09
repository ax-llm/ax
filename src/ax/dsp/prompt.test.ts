import { describe, expect, it } from 'vitest';

import { countChatPromptContentChars } from '../ai/promptMetrics.js';
import { AxPromptTemplate } from './prompt.js';
import { AxSignature, f } from './sig.js';

describe('AxPromptTemplate.render', () => {
  type TestExpectedMessage = { role: 'user' | 'assistant'; content: string };

  describe('Single AxGenIn input (existing behavior)', () => {
    it('should render a basic prompt with single AxGenIn', () => {
      const signature = AxSignature.from(
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

    it('should render with examples as message pairs by default', () => {
      const signature = AxSignature.from(
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

  describe('Value-aware input field metadata', () => {
    const getSystemContent = (
      messages: ReturnType<AxPromptTemplate['render']>
    ) => (messages[0] as { role: 'system'; content: string }).content;

    const getUserContent = (messages: ReturnType<AxPromptTemplate['render']>) =>
      (messages[messages.length - 1] as { role: 'user'; content: string })
        .content;

    it('omits optional input fields that are not provided', () => {
      const sig = f()
        .input('userRequest', f.string('Latest user request'))
        .input(
          'conversationHistory',
          f.json('Prior user and assistant messages').optional()
        )
        .output('answer', f.string())
        .build();
      const template = new AxPromptTemplate(sig);

      const messages = template.render({ userRequest: 'hello' }, {});
      const systemContent = getSystemContent(messages);
      const userContent = getUserContent(messages);

      expect(systemContent).toContain('User Request: Latest user request');
      expect(systemContent).not.toContain('Conversation History:');
      expect(systemContent).not.toContain(
        'This optional JSON object field may be omitted'
      );
      expect(userContent).toContain('User Request: hello');
      expect(userContent).not.toContain('Conversation History:');
    });

    it('includes provided optional input fields without optional wording', () => {
      const sig = f()
        .input('userRequest', f.string('Latest user request'))
        .input(
          'conversationHistory',
          f.json('Prior user and assistant messages').optional()
        )
        .output('answer', f.string())
        .build();
      const template = new AxPromptTemplate(sig);

      const messages = template.render(
        {
          userRequest: 'hello',
          conversationHistory: { messages: ['previous turn'] },
        },
        {}
      );
      const systemContent = getSystemContent(messages);
      const userContent = getUserContent(messages);

      expect(systemContent).toContain(
        'Conversation History: Prior user and assistant messages'
      );
      expect(systemContent).not.toContain(
        'This optional JSON object field may be omitted'
      );
      expect(userContent).toContain('Conversation History:');
      expect(userContent).toContain('previous turn');
    });

    it('treats optional false and zero values as provided', () => {
      const sig = f()
        .input('userRequest', f.string('Latest user request'))
        .input(
          'enabled',
          f.boolean('Whether the feature is enabled').optional()
        )
        .input('limit', f.number('Maximum result count').optional())
        .output('answer', f.string())
        .build();
      const template = new AxPromptTemplate(sig);

      const messages = template.render(
        { userRequest: 'hello', enabled: false, limit: 0 },
        {}
      );
      const systemContent = getSystemContent(messages);
      const userContent = getUserContent(messages);

      expect(systemContent).toContain(
        'Enabled: Whether the feature is enabled'
      );
      expect(systemContent).toContain('Limit: Maximum result count');
      expect(userContent).toContain('Enabled: false');
      expect(userContent).toContain('Limit: 0');
    });

    it('uses ISO datetime examples in prompts', () => {
      const sig = f()
        .input('currentDate', f.datetime('Current timestamp'))
        .output('scheduledAt', f.datetime())
        .build();
      const template = new AxPromptTemplate(sig);

      const messages = template.render(
        { currentDate: new Date(Date.UTC(2022, 0, 1, 12, 0, 10)) },
        {}
      );
      const systemContent = getSystemContent(messages);
      const userContent = getUserContent(messages);

      expect(systemContent).toContain('datetime (ISO 8601 with timezone');
      expect(systemContent).toContain('2024-05-09T14:30:00Z');
      expect(userContent).toContain('Current Date: 2022-01-01T12:00:10Z');
    });

    it('uses range examples in prompts', () => {
      const sig = f()
        .input('availableWindow', f.datetimeRange('Available time'))
        .output('travelDates', f.dateRange())
        .output('selectedWindow', f.datetimeRange())
        .build();
      const template = new AxPromptTemplate(sig);

      const messages = template.render(
        {
          availableWindow: {
            start: new Date(Date.UTC(2022, 0, 1, 12, 0, 0)),
            end: new Date(Date.UTC(2022, 0, 1, 13, 30, 0)),
          },
        },
        {}
      );
      const systemContent = getSystemContent(messages);
      const userContent = getUserContent(messages);

      expect(systemContent).toContain('datetime range');
      expect(systemContent).toContain('date range');
      expect(userContent).toContain('"start": "2022-01-01T12:00:00Z"');
      expect(userContent).toContain('"end": "2022-01-01T13:30:00Z"');
    });
  });

  describe('renderWithMetrics', () => {
    it('should report only mutable chat context when no examples are present', () => {
      const signature = AxSignature.from(
        'userQuery:string -> aiResponse:string "the result"'
      );
      const template = new AxPromptTemplate(signature);

      const rendered = template.renderWithMetrics({ userQuery: 'test' }, {});

      expect(rendered.promptMetrics.exampleChatContextCharacters).toBe(0);
      expect(rendered.promptMetrics.mutableChatContextCharacters).toBe(
        countChatPromptContentChars(rendered.chatPrompt.slice(1) as any)
      );
      expect(rendered.promptMetrics.totalPromptCharacters).toBe(
        countChatPromptContentChars(rendered.chatPrompt as any)
      );
    });

    it('should separate example and mutable chars for message-pair examples', () => {
      const signature = AxSignature.from(
        'userQuery:string -> aiResponse:string "the result"'
      );
      const template = new AxPromptTemplate(signature);

      const rendered = template.renderWithMetrics(
        { userQuery: 'test' },
        {
          examples: [{ userQuery: 'hello', aiResponse: 'world' }],
        }
      );

      expect(rendered.promptMetrics.exampleChatContextCharacters).toBe(
        countChatPromptContentChars(rendered.chatPrompt.slice(1, 3) as any)
      );
      expect(rendered.promptMetrics.mutableChatContextCharacters).toBe(
        countChatPromptContentChars(rendered.chatPrompt.slice(3) as any)
      );
      expect(
        rendered.promptMetrics.exampleChatContextCharacters
      ).toBeGreaterThan(0);
      expect(rendered.promptMetrics.totalPromptCharacters).toBe(
        countChatPromptContentChars(rendered.chatPrompt as any)
      );
    });

    it('should count only text parts for multimodal mutable user content', () => {
      const signature = AxSignature.from('note:string -> answer:string');
      const template = new AxPromptTemplate(signature, undefined, {
        note: (_field, value) => [
          { type: 'text', text: `Note: ${String(value)}` },
          { type: 'image', image: 'data:image/png;base64,abc' },
        ],
      });

      const rendered = template.renderWithMetrics({ note: 'look here' }, {});

      expect(rendered.promptMetrics.exampleChatContextCharacters).toBe(0);
      expect(rendered.promptMetrics.mutableChatContextCharacters).toBe(
        'Note: look here\n'.length
      );
      expect(rendered.promptMetrics.totalPromptCharacters).toBe(
        countChatPromptContentChars(rendered.chatPrompt as any)
      );
    });
  });

  describe('number fields with zero values', () => {
    it('should handle zero values correctly for number fields', () => {
      const signature = AxSignature.from(
        'query:string, priority:number -> responseText:string, score:number'
      );
      const template = new AxPromptTemplate(signature);

      const result = template.render({ query: 'test', priority: 0 }, {});

      expect(result).toHaveLength(2);
      expect(result[1]?.role).toBe('user');
      const userMessage = result[1] as { role: 'user'; content: string };
      expect(userMessage?.content).toContain('Priority: 0');
    });

    it('should handle zero in examples correctly (message pairs)', () => {
      const signature = AxSignature.from(
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
      const signature = AxSignature.from(
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
      const signature = AxSignature.from(
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

    it('should handle false boolean values correctly in examples (message pairs)', () => {
      const signature = AxSignature.from(
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
      const signature = AxSignature.from(
        'userQuery:string -> aiResponse:string, categoryType:string'
      );
      const template = new AxPromptTemplate(signature);

      const examples = [{ userQuery: 'hello', aiResponse: 'world' }]; // missing category output field

      expect(() => {
        template.render({ userQuery: 'test' }, { examples });
      }).not.toThrow();
    });

    it('should skip examples with all input fields missing (message pairs)', () => {
      const signature = AxSignature.from(
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
      const signature = AxSignature.from(
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
      const signature = AxSignature.from(
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

  describe('File field handling', () => {
    it('should render file field with data (base64)', () => {
      const sig = AxSignature.from('fileInput:file -> responseText:string');
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
      const sig = AxSignature.from('fileInput:file -> responseText:string');
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
      const sig = AxSignature.from('fileInputs:file[] -> responseText:string');
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
      const sig = AxSignature.from('fileInput:file -> responseText:string');
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

  describe('Image field handling', () => {
    it('should render image field with data (base64)', () => {
      const sig = new AxSignature('imageInput:image -> responseText:string');
      const pt = new AxPromptTemplate(sig);

      const result = pt.render(
        {
          imageInput: {
            mimeType: 'image/png',
            data: 'base64data',
          },
        },
        {}
      );

      expect(result).toHaveLength(2); // system + user message

      const userMessage = result.find((m) => m.role === 'user');
      expect(userMessage).toBeDefined();
      expect(userMessage!.content).toHaveLength(2);
      expect(userMessage!.content[0]).toEqual({
        type: 'text',
        text: 'Image Input: \n',
      });
      expect(userMessage!.content[1]).toEqual({
        type: 'image',
        mimeType: 'image/png',
        image: 'base64data',
      });
    });

    it('should render image field with fileUri (URL)', () => {
      const sig = new AxSignature('imageInput:image -> responseText:string');
      const pt = new AxPromptTemplate(sig);

      const result = pt.render(
        {
          imageInput: {
            mimeType: 'image/png',
            fileUri: 'https://example.com/cat.png',
          },
        },
        {}
      );

      expect(result).toHaveLength(2); // system + user message

      const userMessage = result.find((m) => m.role === 'user');
      expect(userMessage).toBeDefined();
      expect(userMessage!.content).toHaveLength(2);
      expect(userMessage!.content[0]).toEqual({
        type: 'text',
        text: 'Image Input: \n',
      });
      expect(userMessage!.content[1]).toEqual({
        type: 'image',
        mimeType: 'image/png',
        fileUri: 'https://example.com/cat.png',
      });
    });

    it('should render array of images with mixed formats', () => {
      const sig = new AxSignature('imageInputs:image[] -> responseText:string');
      const pt = new AxPromptTemplate(sig);

      const result = pt.render(
        {
          imageInputs: [
            {
              mimeType: 'image/png',
              data: 'base64data1',
            },
            {
              mimeType: 'image/jpeg',
              fileUri: 'https://example.com/dog.jpg',
            },
          ],
        },
        {}
      );

      expect(result).toHaveLength(2); // system + user message

      const userMessage = result.find((m) => m.role === 'user');
      expect(userMessage).toBeDefined();
      expect(userMessage!.content).toHaveLength(3);

      expect(userMessage!.content[0]).toEqual({
        type: 'text',
        text: 'Image Inputs: \n',
      });

      // First image with data
      expect(userMessage!.content[1]).toEqual({
        type: 'image',
        mimeType: 'image/png',
        image: 'base64data1',
      });

      // Second image with fileUri
      expect(userMessage!.content[2]).toEqual({
        type: 'image',
        mimeType: 'image/jpeg',
        fileUri: 'https://example.com/dog.jpg',
      });
    });

    it('should validate image field requirements', () => {
      const sig = new AxSignature('imageInput:image -> responseText:string');
      const pt = new AxPromptTemplate(sig);

      // Missing mimeType
      expect(() =>
        pt.render(
          {
            imageInput: {
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
            imageInput: {
              mimeType: 'image/png',
            },
          },
          {}
        )
      ).toThrow(/mimeType.*data.*fileUri/);

      // Both data and fileUri present
      expect(() =>
        pt.render(
          {
            imageInput: {
              mimeType: 'image/png',
              data: 'base64data',
              fileUri: 'https://example.com/cat.png',
            },
          },
          {}
        )
      ).toThrow(/mimeType.*data.*fileUri/);
    });
  });

  describe('Examples as alternating message pairs (new default behavior)', () => {
    it('should render multiple examples as alternating user/assistant pairs', () => {
      const signature = AxSignature.from(
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
      const signature = AxSignature.from(
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
      const signature = AxSignature.from(
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
      const signature = AxSignature.from(
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
      const signature = AxSignature.from(
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

    it('should skip output-only demos (no input fields)', () => {
      const signature = AxSignature.from(
        'userQuery:string -> aiResponse:string'
      );
      const template = new AxPromptTemplate(signature);

      // Demo with only output field, no input — should be skipped
      const demos = [{ aiResponse: 'demo output only' }];
      const result = template.render({ userQuery: 'test' }, { demos });

      // Should only have: system, user (query) — demo skipped
      expect(result).toHaveLength(2);
      expect(result[0]?.role).toBe('system');
      expect(result[1]?.role).toBe('user');
    });

    it('should skip output-only items when passed as examples', () => {
      const signature = AxSignature.from(
        'userQuery:string -> aiResponse:string'
      );
      const template = new AxPromptTemplate(signature);

      // Examples with only output — should be skipped
      const examples = [{ aiResponse: 'orphan output' }];
      const result = template.render({ userQuery: 'test' }, { examples });

      // Should only have: system, user (query) — example skipped
      expect(result).toHaveLength(2);
      expect(result[0]?.role).toBe('system');
      expect(result[1]?.role).toBe('user');
    });

    it('should render without examples when none provided', () => {
      const signature = AxSignature.from(
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
      const signature = AxSignature.from(
        'userQuery:string -> aiResponse:string'
      );
      const template = new AxPromptTemplate(signature);

      const examples = [{ userQuery: 'hello', aiResponse: 'world' }];
      const result = template.render({ userQuery: 'test' }, { examples });

      const systemMessage = result[0] as { role: 'system'; content: string };
      expect(systemMessage.content).toContain('## Example Demonstrations');
    });

    it('should add separator before final user message when examples exist', () => {
      const signature = AxSignature.from(
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
      const signature = AxSignature.from(
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
      const signature = AxSignature.from(
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

    it('should NOT add disclaimer/separator when examples array is empty', () => {
      const signature = AxSignature.from(
        'userQuery:string -> aiResponse:string'
      );
      const template = new AxPromptTemplate(signature);

      const result = template.render({ userQuery: 'test' }, { examples: [] });

      const systemMessage = result[0] as { role: 'system'; content: string };
      expect(systemMessage.content).not.toContain('## Example Demonstrations');

      const userMessage = result[1] as { role: 'user'; content: string };
      expect(userMessage.content).not.toContain('--- END OF EXAMPLES ---');
    });
  });

  describe('Multimodal message-pair cache boundaries', () => {
    it('caches the system prompt and final example assistant message', () => {
      const signature = AxSignature.from(
        'imageInput:image -> description:string'
      );
      const template = new AxPromptTemplate(signature, {
        contextCache: { ttlSeconds: 3600 },
      });

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

      expect(result).toHaveLength(4);
      expect(result[0]?.role).toBe('system');
      expect(result[1]?.role).toBe('user');
      expect(result[2]?.role).toBe('assistant');
      expect(result[3]?.role).toBe('user');

      const systemMsg = result[0] as { role: 'system'; cache?: boolean };
      expect(systemMsg.cache).toBe(true);

      const exampleMsg = result[1] as {
        role: 'user';
        cache?: boolean;
        content: unknown[];
      };
      expect(exampleMsg.cache).toBeUndefined();
      expect(Array.isArray(exampleMsg.content)).toBe(true);
      expect(exampleMsg.content.some((c: any) => c.type === 'image')).toBe(
        true
      );

      const assistantMsg = result[2] as {
        role: 'assistant';
        cache?: boolean;
        content: string;
      };
      expect(assistantMsg.cache).toBe(true);
      expect(assistantMsg.content).toContain('Description: A beautiful sunset');

      const liveInputMsg = result[3] as {
        role: 'user';
        cache?: boolean;
        content: unknown[];
      };
      expect(liveInputMsg.cache).toBeUndefined();
      expect(Array.isArray(liveInputMsg.content)).toBe(true);
      expect(liveInputMsg.content.some((c: any) => c.type === 'image')).toBe(
        true
      );
    });

    it('keeps example and live multimodal messages separate without example caching', () => {
      const signature = AxSignature.from(
        'imageInput:image -> description:string'
      );
      const template = new AxPromptTemplate(signature, {
        contextCache: { ttlSeconds: 3600, cacheBreakpoint: 'system' },
      });

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

      expect(result).toHaveLength(4);
      expect(result[1]?.role).toBe('user');
      expect(result[2]?.role).toBe('assistant');
      expect(result[3]?.role).toBe('user');
      expect((result[1] as { cache?: boolean }).cache).toBeUndefined();
      expect((result[2] as { cache?: boolean }).cache).toBeUndefined();
      expect((result[3] as { cache?: boolean }).cache).toBeUndefined();
    });
  });

  describe('Context caching breakpoint options', () => {
    it('should set cache:true on the trailing function result for structured-output examples', () => {
      const signature = f()
        .input('question', f.string())
        .output(
          'routingDecision',
          f.object({
            answer: f.string(),
          })
        )
        .build();

      const template = new AxPromptTemplate(signature, {
        contextCache: { ttlSeconds: 3600 },
        structuredOutputFunctionName: '__finalResult',
      });

      const examples = [
        {
          question: 'How should I search?',
          routingDecision: { answer: 'Use searchWeb' },
        },
      ];

      const result = template.render(
        { question: 'Where should I route this?' },
        { examples }
      );

      expect(result.map((msg) => msg.role)).toEqual([
        'system',
        'user',
        'assistant',
        'function',
        'user',
      ]);

      const functionMsg = result[3] as {
        role: 'function';
        cache?: boolean;
      };
      expect(functionMsg.cache).toBe(true);
    });

    it('should set cache:true on last example by default (after-examples)', () => {
      const signature = AxSignature.from(
        'userQuery:string -> aiResponse:string'
      );
      const template = new AxPromptTemplate(signature, {
        contextCache: { ttlSeconds: 3600 },
      });

      const examples = [
        { userQuery: 'hello', aiResponse: 'world' },
        { userQuery: 'foo', aiResponse: 'bar' },
      ];
      const result = template.render({ userQuery: 'test' }, { examples });

      // System should have cache: true
      expect(result[0]).toHaveProperty('cache', true);

      // Last assistant (example 2) should have cache: true
      const assistantMessages = result.filter(
        (m) => m.role === 'assistant'
      ) as Array<{ role: 'assistant'; cache?: boolean }>;
      expect(assistantMessages.length).toBe(2);
      expect(assistantMessages[1]).toHaveProperty('cache', true);
      expect(assistantMessages[0]).not.toHaveProperty('cache');
    });

    it('should NOT set cache:true on examples when cacheBreakpoint is after-functions', () => {
      const signature = AxSignature.from(
        'userQuery:string -> aiResponse:string'
      );
      const template = new AxPromptTemplate(signature, {
        contextCache: { ttlSeconds: 3600, cacheBreakpoint: 'after-functions' },
      });

      const examples = [
        { userQuery: 'hello', aiResponse: 'world' },
        { userQuery: 'foo', aiResponse: 'bar' },
      ];
      const result = template.render({ userQuery: 'test' }, { examples });

      // System should still have cache: true
      expect(result[0]).toHaveProperty('cache', true);

      // Assistant messages should NOT have cache: true
      const assistantMessages = result.filter(
        (m) => m.role === 'assistant'
      ) as Array<{ role: 'assistant'; cache?: boolean }>;
      expect(assistantMessages.length).toBe(2);
      for (const msg of assistantMessages) {
        expect(msg.cache).toBeUndefined();
      }
    });

    it('should NOT set cache:true on examples when cacheBreakpoint is system', () => {
      const signature = AxSignature.from(
        'userQuery:string -> aiResponse:string'
      );
      const template = new AxPromptTemplate(signature, {
        contextCache: { ttlSeconds: 3600, cacheBreakpoint: 'system' },
      });

      const examples = [{ userQuery: 'hello', aiResponse: 'world' }];
      const result = template.render({ userQuery: 'test' }, { examples });

      // System should still have cache: true
      expect(result[0]).toHaveProperty('cache', true);

      // Assistant messages should NOT have cache: true
      const assistantMessages = result.filter(
        (m) => m.role === 'assistant'
      ) as Array<{ role: 'assistant'; cache?: boolean }>;
      expect(assistantMessages.length).toBe(1);
      expect(assistantMessages[0]?.cache).toBeUndefined();
    });

    it('should NOT set cache flags when no contextCache is configured', () => {
      const signature = AxSignature.from(
        'userQuery:string -> aiResponse:string'
      );
      const template = new AxPromptTemplate(signature);

      const examples = [{ userQuery: 'hello', aiResponse: 'world' }];
      const result = template.render({ userQuery: 'test' }, { examples });

      // Without contextCache, no cache flags should be set
      const assistantMessages = result.filter(
        (m) => m.role === 'assistant'
      ) as Array<{ role: 'assistant'; cache?: boolean }>;
      expect(assistantMessages.length).toBe(1);
      expect(assistantMessages[0]?.cache).toBeUndefined();
    });
  });

  describe('Cached input fields', () => {
    it('should render cached fields in separate user message with cache:true', () => {
      const sig = f()
        .input('staticContext', f.string('Static').cache())
        .input('userQuery', f.string('Dynamic'))
        .output('answer', f.string())
        .build();

      const template = new AxPromptTemplate(sig, {
        contextCache: { ttlSeconds: 3600 },
      });

      const result = template.render(
        { staticContext: 'cached content', userQuery: 'question' },
        {}
      );

      // Should have: system, user (cached), user (non-cached)
      expect(result.length).toBe(3);

      // First user message should have cached field and cache: true
      const firstUser = result[1] as {
        role: 'user';
        content: string;
        cache?: boolean;
      };
      expect(firstUser.role).toBe('user');
      expect(firstUser.cache).toBe(true);
      expect(firstUser.content).toContain('Static Context');

      // Second user message should have non-cached field and no cache
      const secondUser = result[2] as {
        role: 'user';
        content: string;
        cache?: boolean;
      };
      expect(secondUser.role).toBe('user');
      expect(secondUser.cache).toBeUndefined();
      expect(secondUser.content).toContain('User Query');
    });

    it('should not emit an empty cached user message when optional cached fields are absent', () => {
      const sig = f()
        .input('stableContext', f.string('Stable').cache().optional())
        .input('userQuery', f.string('Dynamic'))
        .output('answer', f.string())
        .build();

      const template = new AxPromptTemplate(sig, {
        contextCache: { ttlSeconds: 3600 },
      });

      const result = template.render({ userQuery: 'question' }, {});

      expect(result.map((msg) => msg.role)).toEqual(['system', 'user']);
      const userMsg = result[1] as {
        role: 'user';
        content: string;
        cache?: boolean;
      };
      expect(userMsg.cache).toBeUndefined();
      expect(userMsg.content).toContain('User Query: question');
      expect(userMsg.content).not.toContain('Stable Context:');
    });

    it('should omit the user message entirely when only absent cached optional fields exist', () => {
      const sig = f()
        .input('stableContext', f.string('Stable').cache().optional())
        .output('answer', f.string())
        .build();

      const template = new AxPromptTemplate(sig, {
        contextCache: { ttlSeconds: 3600 },
      });

      const result = template.render({}, {});

      expect(result.map((msg) => msg.role)).toEqual(['system']);
      expect(result[0]).toHaveProperty('cache', true);
    });

    it('can keep absent optional input field definitions stable in the system prompt', () => {
      const sig = f()
        .input('userQuery', f.string('Dynamic'))
        .input('stableContext', f.string('Stable').cache().optional())
        .output('answer', f.string())
        .build();

      const template = new AxPromptTemplate(sig, {
        includeOptionalInputFieldsInSystemPrompt: true,
        contextCache: { ttlSeconds: 3600 },
      });

      const result = template.render({ userQuery: 'question' }, {});
      const systemMsg = result[0] as { role: 'system'; content: string };
      const userMsg = result[1] as { role: 'user'; content: string };

      expect(systemMsg.content).toContain('Stable Context: Stable');
      expect(userMsg.content).toContain('User Query: question');
      expect(userMsg.content).not.toContain('Stable Context:');
    });

    it('should not separate fields when contextCache is not configured', () => {
      const sig = f()
        .input('staticContext', f.string('Static').cache())
        .input('userQuery', f.string('Dynamic'))
        .output('answer', f.string())
        .build();

      const template = new AxPromptTemplate(sig);

      const result = template.render(
        { staticContext: 'cached content', userQuery: 'question' },
        {}
      );

      // Should have: system, user (all fields together)
      expect(result.length).toBe(2);
      const userMsg = result[1] as { role: 'user'; cache?: boolean };
      expect(userMsg.cache).toBeUndefined();
    });

    it('should set cache:true on last user message when all fields are cached', () => {
      const sig = f()
        .input('field1', f.string().cache())
        .input('field2', f.string().cache())
        .output('answer', f.string())
        .build();

      const template = new AxPromptTemplate(sig, {
        contextCache: { ttlSeconds: 3600 },
      });

      const result = template.render({ field1: 'a', field2: 'b' }, {});

      // Should have: system, user (all cached)
      expect(result.length).toBe(2);
      const userMsg = result[1] as { role: 'user'; cache?: boolean };
      expect(userMsg.cache).toBe(true);
    });

    it('should not set cache when no fields are cached', () => {
      const sig = f()
        .input('field1', f.string())
        .input('field2', f.string())
        .output('answer', f.string())
        .build();

      const template = new AxPromptTemplate(sig, {
        contextCache: { ttlSeconds: 3600 },
      });

      const result = template.render({ field1: 'a', field2: 'b' }, {});

      // Should have: system, user (no cache)
      expect(result.length).toBe(2);
      const userMsg = result[1] as { role: 'user'; cache?: boolean };
      expect(userMsg.cache).toBeUndefined();
    });

    it('should render cached fields first in examples', () => {
      const sig = f()
        .input('userQuery', f.string('Dynamic'))
        .input('staticContext', f.string('Static').cache())
        .output('answer', f.string())
        .build();

      const template = new AxPromptTemplate(sig, {
        contextCache: { ttlSeconds: 3600 },
      });

      const examples = [
        { userQuery: 'q1', staticContext: 'ctx1', answer: 'a1' },
      ];
      const result = template.render(
        { staticContext: 'cached', userQuery: 'question' },
        { examples }
      );

      // Example user message should have cached field first
      const exampleUser = result[1] as { role: 'user'; content: string };
      expect(exampleUser.role).toBe('user');
      // staticContext should appear before userQuery in the content
      const staticIdx = exampleUser.content.indexOf('Static Context');
      const queryIdx = exampleUser.content.indexOf('User Query');
      expect(staticIdx).toBeLessThan(queryIdx);
    });

    it('should not split cached fields when cacheBreakpoint is system', () => {
      const sig = f()
        .input('staticContext', f.string('Static').cache())
        .input('userQuery', f.string('Dynamic'))
        .output('answer', f.string())
        .build();

      const template = new AxPromptTemplate(sig, {
        contextCache: { ttlSeconds: 3600, cacheBreakpoint: 'system' },
      });

      const result = template.render(
        { staticContext: 'cached', userQuery: 'question' },
        {}
      );

      // Should have: system, user (all fields together, no cache on user)
      expect(result.length).toBe(2);
      const userMsg = result[1] as { role: 'user'; cache?: boolean };
      expect(userMsg.cache).toBeUndefined();
    });

    it('should not split cached fields when cacheBreakpoint is after-functions', () => {
      const sig = f()
        .input('staticContext', f.string('Static').cache())
        .input('userQuery', f.string('Dynamic'))
        .output('answer', f.string())
        .build();

      const template = new AxPromptTemplate(sig, {
        contextCache: { ttlSeconds: 3600, cacheBreakpoint: 'after-functions' },
      });

      const result = template.render(
        { staticContext: 'cached', userQuery: 'question' },
        {}
      );

      // Should have: system, user (all fields together, no cache on user)
      expect(result.length).toBe(2);
      const userMsg = result[1] as { role: 'user'; cache?: boolean };
      expect(userMsg.cache).toBeUndefined();
    });

    it('preserves part-level cache metadata when adjacent text parts are merged', () => {
      const sig = AxSignature.from('note:string -> answer:string');
      const template = new AxPromptTemplate(sig, undefined, {
        note: () => [
          { type: 'text', text: 'Cached prefix', cache: true },
          { type: 'text', text: 'Dynamic suffix' },
          { type: 'image', mimeType: 'image/png', image: 'abc123' },
        ],
      });

      const result = template.render({ note: 'ignored' }, {});
      const userMsg = result[1] as {
        role: 'user';
        content: Array<{ type: string; text?: string; cache?: boolean }>;
      };

      expect(Array.isArray(userMsg.content)).toBe(true);
      expect(userMsg.content[0]?.type).toBe('text');
      expect(userMsg.content[0]?.cache).toBe(true);
      expect(userMsg.content[0]?.text).toContain('Cached prefix');
      expect(userMsg.content[0]?.text).toContain('Dynamic suffix');
    });
  });

  describe('Field name references in descriptions', () => {
    it('should format field names in input field descriptions', () => {
      const signature = AxSignature.from(
        'taskAnalysis:string "analyze the task", resultData:string "based on taskAnalysis" -> outputText:string'
      );
      const template = new AxPromptTemplate(signature);
      const rendered = template.render(
        { taskAnalysis: 'test', resultData: 'r' },
        {}
      );

      const systemMessage = rendered[0] as { role: 'system'; content: string };
      // Description should contain formatted field reference
      expect(systemMessage.content).toContain('`Task Analysis`');
    });

    it('should format field names in output field descriptions', () => {
      const signature = AxSignature.from(
        'inputText:string -> summaryText:string "summarizes inputText", analysisText:string "based on summaryText"'
      );
      const template = new AxPromptTemplate(signature);
      const rendered = template.render({ inputText: 'test' }, {});

      const systemMessage = rendered[0] as { role: 'system'; content: string };
      expect(systemMessage.content).toContain('`Summary Text`');
    });

    it('should format field names in signature description', () => {
      const signature = AxSignature.from(
        'taskAnalysis:string -> resultText:string "Generate resultText from taskAnalysis"'
      );
      signature.setDescription(
        'This uses taskAnalysis to produce a resultText'
      );
      const template = new AxPromptTemplate(signature);
      const rendered = template.render({ taskAnalysis: 'test' }, {});

      const systemMessage = rendered[0] as { role: 'system'; content: string };
      expect(systemMessage.content).toContain('`Task Analysis`');
    });

    it('should format field names in backticks without double-wrapping', () => {
      const signature = AxSignature.from(
        'taskAnalysis:string "the `taskAnalysis` field" -> resultText:string'
      );
      const template = new AxPromptTemplate(signature);
      const rendered = template.render({ taskAnalysis: 'test' }, {});

      const systemMessage = rendered[0] as { role: 'system'; content: string };
      // Should not have double backticks
      expect(systemMessage.content).not.toContain('``');
      // Should have formatted title
      expect(systemMessage.content).toContain('`Task Analysis`');
      // Should not have raw field name in backticks
      expect(systemMessage.content).not.toContain('`taskAnalysis`');
    });

    it('should format field names in square brackets without adding backticks', () => {
      const signature = AxSignature.from(
        'taskAnalysis:string "see [taskAnalysis] for details" -> resultText:string'
      );
      const template = new AxPromptTemplate(signature);
      const rendered = template.render({ taskAnalysis: 'test' }, {});

      const systemMessage = rendered[0] as { role: 'system'; content: string };
      expect(systemMessage.content).toContain('[Task Analysis]');
      expect(systemMessage.content).not.toContain('[`Task Analysis`]');
    });

    it('should format field names in parentheses without adding backticks', () => {
      const signature = AxSignature.from(
        'taskAnalysis:string "uses (taskAnalysis) internally" -> resultText:string'
      );
      const template = new AxPromptTemplate(signature);
      const rendered = template.render({ taskAnalysis: 'test' }, {});

      const systemMessage = rendered[0] as { role: 'system'; content: string };
      expect(systemMessage.content).toContain('(Task Analysis)');
      expect(systemMessage.content).not.toContain('(`Task Analysis`)');
    });

    it('should handle multiple field references in one description', () => {
      const signature = AxSignature.from(
        'fieldAlpha:string, fieldBeta:string -> resultText:string "combines fieldAlpha and fieldBeta"'
      );
      const template = new AxPromptTemplate(signature);
      const rendered = template.render({ fieldAlpha: 'a', fieldBeta: 'b' }, {});

      const systemMessage = rendered[0] as { role: 'system'; content: string };
      expect(systemMessage.content).toContain('`Field Alpha`');
      expect(systemMessage.content).toContain('`Field Beta`');
    });

    it('should not replace partial word matches', () => {
      const signature = AxSignature.from(
        'userId:string "the identifier" -> resultText:string "provides identity"'
      );
      const template = new AxPromptTemplate(signature);
      const rendered = template.render({ userId: 'test' }, {});

      const systemMessage = rendered[0] as { role: 'system'; content: string };
      // "identity" should not become "`User Id`entity"
      expect(systemMessage.content).toContain('identity');
      expect(systemMessage.content).not.toContain('`User Id`entity');
    });
  });
});
