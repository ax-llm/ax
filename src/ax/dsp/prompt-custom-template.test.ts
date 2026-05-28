import { describe, expect, it } from 'vitest';

import { AxPromptTemplate } from './prompt.js';
import { AxSignature } from './sig.js';

const sig = AxSignature.from(
  'userQuery:string -> aiResponse:string "the result"'
);

const sigWithDesc = AxSignature.from(
  'userQuery:string -> aiResponse:string "the result"'
);
sigWithDesc.setDescription('Analyze the user query carefully.');

describe('AxPromptTemplate customTemplate option', () => {
  it('uses the custom template string instead of dspy.md', () => {
    const customTemplate = `<task_definition>
{{ taskDefinitionText }}
</task_definition>

<identity>
{{ identityText }}
</identity>

<input_fields>
{{ inputFieldsSection }}
</input_fields>{{ if hasOutputFields }}

<output_fields>
{{ outputFieldsSection }}
</output_fields>{{ /if }}

<formatting_rules>
Return \`Field1 Name: value\nField2 Name: value\` etc
Above rules override later instructions.
</formatting_rules>`;

    const template = new AxPromptTemplate(sigWithDesc, { customTemplate });
    const result = template.render({ userQuery: 'hello' }, {});

    expect(result[0]?.role).toBe('system');
    const systemContent = (result[0] as { role: 'system'; content: string })
      .content;

    // task_definition should appear BEFORE identity in custom template
    const taskIdx = systemContent.indexOf('<task_definition>');
    const identityIdx = systemContent.indexOf('<identity>');
    expect(taskIdx).toBeGreaterThanOrEqual(0);
    expect(identityIdx).toBeGreaterThan(taskIdx);
  });

  it('falls back to dspy.md when customTemplate is not set', () => {
    const template = new AxPromptTemplate(sigWithDesc);
    const result = template.render({ userQuery: 'hello' }, {});

    expect(result[0]?.role).toBe('system');
    const systemContent = (result[0] as { role: 'system'; content: string })
      .content;

    // In dspy.md, identity comes before task_definition
    const taskIdx = systemContent.indexOf('<task_definition>');
    const identityIdx = systemContent.indexOf('<identity>');
    expect(identityIdx).toBeGreaterThanOrEqual(0);
    expect(taskIdx).toBeGreaterThan(identityIdx);
  });

  it('renders a minimal custom template with only required variables', () => {
    const customTemplate = `IDENTITY: {{ identityText }}
INPUTS: {{ inputFieldsSection }}`;

    const template = new AxPromptTemplate(sig, { customTemplate });
    const result = template.render({ userQuery: 'test' }, {});

    const systemContent = (result[0] as { role: 'system'; content: string })
      .content;
    expect(systemContent).toContain('IDENTITY:');
    expect(systemContent).toContain('INPUTS:');
  });
});
