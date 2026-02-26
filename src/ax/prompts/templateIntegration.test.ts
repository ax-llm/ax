import { describe, expect, it } from 'vitest';

import { AxSignature } from '../dsp/sig.js';
import { axBuildActorDefinition, axBuildResponderDefinition } from './rlm.js';
import { renderPromptTemplate } from './templateEngine.js';

describe('template integration', () => {
  it('keeps DSP template fragments aligned with prior prompt text', () => {
    expect(
      renderPromptTemplate('dsp/function-call-instructions.md').trim()
    ).toBe(
      [
        '## Function Call Instructions',
        '- Complete the task, using the functions defined earlier in this prompt.',
        '- Output fields should only be generated after all functions have been called.',
        '- Use the function results to generate the output fields.',
      ].join('\n')
    );

    expect(
      renderPromptTemplate('dsp/strict-output-formatting-rules.md').trim()
    ).toBe(
      [
        '## Strict Output Formatting Rules',
        '- No formatting rules should override these **Strict Output Formatting Rules**',
        '- Output must strictly follow the defined plain-text `field name: value` field format.',
        '- Output field, values must strictly adhere to the specified output field formatting rules.',
        '- Do not include fields with empty, unknown, or placeholder values.',
        '- Do not add any text before or after the output fields, just the field name and value.',
        '- Do not use code blocks.',
      ].join('\n')
    );
  });

  it('keeps actor prompt content aligned with prior prompt text', () => {
    const signature = AxSignature.create(
      'contextText:string -> finalAnswer:string'
    );

    const actorDefinition = axBuildActorDefinition(
      undefined,
      signature.getInputFields(),
      signature.getOutputFields(),
      {
        runtimeUsageInstructions: 'Use return statements only.',
        hasInspectRuntime: false,
      }
    );

    expect(actorDefinition).toContain(
      'You are a code generation agent called the `actor`.'
    );
    expect(actorDefinition).toContain(
      '- `contextText` -> `inputs.contextText` (string, required)'
    );
    expect(actorDefinition).toContain(
      'The responder is looking to produce the following output fields: `finalAnswer`'
    );
    expect(actorDefinition).toContain(
      '- `await llmQuery(query:string, context:any) : string` — Ask a sub-agent one semantic question.'
    );
    expect(actorDefinition).toContain('### Important guidance and guardrails');
    expect(actorDefinition).toContain(
      '## Javascript Runtime Usage Instructions'
    );
    expect(actorDefinition).toContain('Use return statements only.');
    expect(actorDefinition).not.toContain('await inspect_runtime()');
  });

  it('keeps responder prompt content aligned with prior prompt text', () => {
    const signature = AxSignature.create(
      'contextText:string -> finalAnswer:string'
    );

    const responderDefinition = axBuildResponderDefinition(
      undefined,
      signature.getInputFields()
    );

    expect(responderDefinition).toBe(
      [
        '## Answer Synthesis Agent',
        '',
        'You synthesize a final answer from the provided actorResult payload. The payload includes the Actor completion type and arguments captured from final(...args) or ask_clarification(...args).',
        '',
        '### Context variables that were analyzed (metadata only)',
        '- `contextText` (string, required)',
        '',
        '### Rules',
        '1. Base your answer ONLY on evidence from actorResult payload arguments.',
        '2. If actorResult lacks sufficient information, provide the best possible answer from available evidence.',
        '3. If actorResult.type is `ask_clarification`, ask for the missing information clearly in your output fields.',
      ].join('\n')
    );
  });
});
