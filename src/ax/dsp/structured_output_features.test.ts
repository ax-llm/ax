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

  it('should render inputs as key-value and outputs as JSON when structured outputs are enabled', () => {
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

    // Access private method for testing or inspect rendered output
    // Since renderExamples is private, we can check the public render method output
    const rendered = template.render({ userQuery: 'test' }, { examples });
    const systemMessage = rendered.find((m) => m.role === 'system');

    // With the new behavior:
    // - Input fields should be in key-value format: "User Query: hello"
    // - Output fields should be in JSON format: {"aiResponse": "world"}
    expect(systemMessage?.content).toContain('User Query: hello');
    expect(systemMessage?.content).toContain('```json');
    expect(systemMessage?.content).toContain('"aiResponse": "world"');
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
});
