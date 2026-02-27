import { describe, expect, it } from 'vitest';
import { AxPromptTemplate } from './prompt.js';
import { f } from './sig.js';

describe('Structured Output Features', () => {
  it('should set _forceComplexFields when useStructured is called', () => {
    const signature = f()
      .input('userQuery', f.string())
      .output('aiResponse', f.string())
      .useStructured()
      .build();

    expect(signature.hasComplexFields()).toBe(true);
  });

  it('should render inputs as key-value and outputs as JSON when structured outputs are enabled (legacy: examplesInSystem)', () => {
    const signature = f()
      .input('userQuery', f.string())
      .output('aiResponse', f.string())
      .useStructured()
      .build();

    const template = new AxPromptTemplate(signature, {
      examplesInSystem: true,
    });
    const examples = [
      {
        userQuery: 'hello',
        aiResponse: 'world',
      },
    ];

    // Access private method for testing or inspect rendered output
    // Since renderExamples is private, we can check the public render method output
    const rendered = template.render({ userQuery: 'test' }, { examples });
    const systemMessage = rendered.find((m) => m.role === 'system');

    // With the legacy behavior (examplesInSystem: true):
    // - Input fields should be in key-value format: "User Query: hello"
    // - Output fields should be in JSON format: {"aiResponse": "world"}
    expect(systemMessage?.content).toContain('User Query: hello');
    expect(systemMessage?.content).toContain('```json');
    expect(systemMessage?.content).toContain('"aiResponse": "world"');
  });

  it('should render inputs as key-value and outputs as JSON when structured outputs are enabled (message pairs)', () => {
    const signature = f()
      .input('userQuery', f.string())
      .output('aiResponse', f.string())
      .useStructured()
      .build();

    const template = new AxPromptTemplate(signature);
    const examples = [
      {
        userQuery: 'hello',
        aiResponse: 'world',
      },
    ];

    // With the new default behavior, examples are rendered as message pairs
    const rendered = template.render({ userQuery: 'test' }, { examples });

    // Should have: system, user (example), assistant (example), user (query)
    expect(rendered.length).toBe(4);

    // Check example user message contains input
    const exampleUser = rendered[1] as { role: 'user'; content: string };
    expect(exampleUser.content).toContain('User Query: hello');

    // Check example assistant message contains JSON output
    const exampleAssistant = rendered[2] as {
      role: 'assistant';
      content: string;
    };
    expect(exampleAssistant.content).toContain('"aiResponse": "world"');
  });

  it('should request full JSON object in error correction for complex fields', () => {
    const signature = f()
      .input('userQuery', f.string())
      .output('itemsList', f.object({ name: f.string() }).array())
      .build();

    const template = new AxPromptTemplate(signature);

    // Simulate error correction request
    const errorFields = [
      {
        name: 'itemsList',
        title: 'Items List',
        description: 'List of items',
        type: {
          name: 'object',
          isArray: true,
          fields: { name: { type: 'string' } },
        },
      },
    ];

    // @ts-ignore - construct AxIField manually for test
    const rendered = template.renderExtraFields(errorFields as any);

    const textParts = rendered
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('');

    expect(textParts).toContain(
      'IMPORTANT: Provide the FULL JSON object for this field'
    );
  });

  it('should separate input fields with newlines in examples when structured outputs are enabled (legacy: examplesInSystem)', () => {
    const signature = f()
      .input('field1', f.string())
      .input('field2', f.string())
      .output('responseText', f.string())
      .useStructured()
      .build();

    const template = new AxPromptTemplate(signature, {
      examplesInSystem: true,
    });
    const examples = [
      {
        field1: 'value1',
        field2: 'value2',
        responseText: 'result',
      },
    ];

    const rendered = template.render(
      { field1: 'test', field2: 'test' },
      { examples }
    );
    const systemMessage = rendered.find((m) => m.role === 'system');

    // Check that fields are separated by newline
    // We expect "Field1: value1\nField2: value2"
    expect(systemMessage?.content).toContain(
      'Field 1: value1\nField 2: value2'
    );
  });

  it('should separate input fields with newlines in examples when structured outputs are enabled (message pairs)', () => {
    const signature = f()
      .input('field1', f.string())
      .input('field2', f.string())
      .output('responseText', f.string())
      .useStructured()
      .build();

    const template = new AxPromptTemplate(signature);
    const examples = [
      {
        field1: 'value1',
        field2: 'value2',
        responseText: 'result',
      },
    ];

    const rendered = template.render(
      { field1: 'test', field2: 'test' },
      { examples }
    );

    // With new default behavior, examples are rendered as message pairs
    expect(rendered.length).toBe(4);

    // Check that example user message contains fields separated by newline
    const exampleUser = rendered[1] as { role: 'user'; content: string };
    expect(exampleUser.content).toContain('Field 1: value1');
    expect(exampleUser.content).toContain('Field 2: value2');
  });

  it('should render structured examples as function calls when structuredOutputFunctionName is set', () => {
    const signature = f()
      .input('userQuery', f.string())
      .output(
        'metadata',
        f.object({
          label: f.string(),
          score: f.number(),
        })
      )
      .build();

    const template = new AxPromptTemplate(signature, {
      structuredOutputFunctionName: 'return_structured',
    });

    const rendered = template.render(
      { userQuery: 'test' },
      {
        examples: [
          {
            userQuery: 'hello',
            metadata: {
              label: 'world',
              score: 1,
            },
          },
        ],
      }
    );

    // Should have: system, user (example), assistant (function call), function result, user (query)
    expect(rendered).toHaveLength(5);
    expect(rendered[1]?.role).toBe('user');
    expect(rendered[2]?.role).toBe('assistant');
    expect(rendered[3]?.role).toBe('function');
    expect(rendered[4]?.role).toBe('user');

    const exampleAssistant = rendered[2] as {
      role: 'assistant';
      functionCalls?: {
        id: string;
        type: 'function';
        function: { name: string; params?: string | object };
      }[];
    };
    const functionCall = exampleAssistant.functionCalls?.[0];
    expect(functionCall?.function.name).toBe('return_structured');
    expect(functionCall?.function.params).toEqual({
      metadata: { label: 'world', score: 1 },
    });

    const functionResult = rendered[3] as {
      role: 'function';
      result: string;
      functionId: string;
    };
    expect(functionResult.result).toBe('done');
    expect(functionResult.functionId).toBe(functionCall?.id);
  });

  it('should preserve all grouped extra field descriptions in error correction', () => {
    const signature = f()
      .input('userQuery', f.string())
      .output('aiResponse', f.string())
      .build();

    const template = new AxPromptTemplate(signature);

    const errorFields = [
      {
        name: 'aiResponse',
        title: 'Ai Response',
        description: 'Missing citation',
        type: { name: 'string' },
      },
      {
        name: 'aiResponse',
        title: 'Ai Response',
        description: 'Tone is too vague',
        type: { name: 'string' },
      },
    ];

    // @ts-ignore - construct AxIField manually for test
    const rendered = template.renderExtraFields(errorFields as any);

    const textParts = rendered
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('');

    expect(textParts).toContain('- Missing citation');
    expect(textParts).toContain('- Tone is too vague');
  });
});
