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
  it('should include thoughtFieldName in instructions when showThoughts is true', () => {
    const signature = f()
      .input('query', f.string())
      .output('answer', f.string())
      .build();
    const template = new AxPromptTemplate(signature, {
      showThoughts: true,
      thoughtFieldName: 'reasoning',
    });

    const rendered = template.render({ query: 'test' }, {});
    const systemMessage = rendered.find((m) => m.role === 'system');

    expect(systemMessage?.content).toContain('## Thought Process');
    expect(systemMessage?.content).toContain(
      'Provide your thinking process in the **reasoning** field'
    );

    // In structured output mode, output fields section also includes it if missing from signature
    expect(systemMessage?.content).toContain('**Output Fields**');
    expect(systemMessage?.content).toContain(
      'Reasoning: (This string field must be included) Provide your thinking process.'
    );
  });

  it('should resolve $fieldName references in descriptions', () => {
    const signature = f()
      .input('context', f.string())
      .output('answer', f.string('Based on $context, provide an answer.'))
      .build();

    const template = new AxPromptTemplate(signature);
    const rendered = template.render({ context: 'test' }, {});
    const systemMessage = rendered.find((m) => m.role === 'system');

    expect(systemMessage?.content).toContain(
      'Based on `Context`, provide an answer'
    );
  });

  it('should use structuredOutputFunctionName in complex field instructions', () => {
    const signature = f()
      .input('query', f.string())
      .output('extractedData', f.object({ valueX: f.number() }))
      .build();

    const template = new AxPromptTemplate(signature, {
      structuredOutputFunctionName: 'call_me',
    });

    const rendered = template.render({ query: 'test' }, {});
    const systemMessage = rendered.find((m) => m.role === 'system');

    expect(systemMessage?.content).toContain(
      'You MUST call the `call_me` function'
    );
  });
});
