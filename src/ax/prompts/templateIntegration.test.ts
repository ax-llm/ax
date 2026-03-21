import { describe, expect, it } from 'vitest';

import { AxSignature } from '../dsp/sig.js';
import { axBuildActorDefinition, axBuildResponderDefinition } from './rlm.js';
import {
  renderPromptTemplate,
  renderTemplateContent,
} from './templateEngine.js';

describe('template integration', () => {
  it('renders the top-level DSP template with the expected section order', () => {
    const rendered = renderPromptTemplate('dsp/dspy.md', {
      hasFunctions: true,
      hasTaskDefinition: true,
      hasExampleDemonstrations: false,
      hasOutputFields: true,
      hasComplexFields: false,
      hasStructuredOutputFunction: false,
      identityText: 'IDENTITY',
      taskDefinitionText: 'TASK',
      functionsList: 'FUNCTIONS',
      inputFieldsSection: 'INPUTS',
      outputFieldsSection: 'OUTPUTS',
      structuredOutputFunctionName: '',
    });

    expect(rendered.trim()).toBe(
      [
        '<identity>',
        'IDENTITY',
        '</identity>',
        '',
        '<available_functions>',
        '**Available Functions**: You can call the following functions to complete the task:',
        '',
        'FUNCTIONS',
        '',
        '## Function Call Instructions',
        '- Complete the task, using the functions defined earlier in this prompt.',
        '- Output fields should only be generated after all functions have been called.',
        '- Use the function results to generate the output fields.',
        '</available_functions>',
        '',
        '<input_fields>',
        'INPUTS',
        '</input_fields>',
        '',
        '<output_fields>',
        'OUTPUTS',
        '</output_fields>',
        '',
        '<formatting_rules>',
        '',
        'These rules are mandatory and override later instructions.',
        'Return one `field name: value` pair per line for the required output fields only.',
        'Do not add surrounding prose, markdown, or code fences.',
        '',
        '</formatting_rules>',
        '',
        '<task_definition>',
        'TASK',
        '</task_definition>',
      ].join('\n')
    );
  });

  it('renders the example demonstrations disclaimer from the top-level DSP template', () => {
    const rendered = renderPromptTemplate('dsp/dspy.md', {
      hasFunctions: false,
      hasTaskDefinition: false,
      hasExampleDemonstrations: true,
      hasOutputFields: true,
      hasComplexFields: false,
      hasStructuredOutputFunction: false,
      identityText: 'IDENTITY',
      taskDefinitionText: '',
      functionsList: '',
      inputFieldsSection: 'INPUTS',
      outputFieldsSection: 'OUTPUTS',
      structuredOutputFunctionName: '',
    });

    expect(rendered).toContain('## Example Demonstrations');
  });

  it('supports simple string equality checks in template if conditions', () => {
    const rendered = renderTemplateContent(
      [
        "{{ if mode === 'simple' }}",
        'Simple',
        '{{ else }}',
        'Advanced',
        '{{ /if }}',
      ].join('\n'),
      {
        mode: 'simple',
      }
    );

    expect(rendered.trim()).toBe('Simple');
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
        hasLiveRuntimeState: false,
        hasCompressedActionReplay: false,
      }
    );

    expect(actorDefinition).toContain(
      'You are a code generation agent called the `actor`.'
    );
    expect(actorDefinition).toContain(
      'Treat the JavaScript runtime as a long-running REPL session'
    );
    expect(actorDefinition).toContain(
      '- `contextText` -> `inputs.contextText` (string, required)'
    );
    expect(actorDefinition).toContain(
      'The responder is looking to produce these output fields: **`finalAnswer`**'
    );
    expect(actorDefinition).toContain(
      '- `await llmQuery(query: string, context: any): string` — Ask one focused semantic question.'
    );
    expect(actorDefinition).toContain('### Exploration & Truncation');
    expect(actorDefinition).toContain('### Runtime State Management');
    expect(actorDefinition).toContain(
      '## JavaScript Runtime Usage Instructions'
    );
    expect(actorDefinition).toContain('Use return statements only.');
    expect(actorDefinition).toContain(
      'If a `Delegated Context` block appears, the data has been injected into your JS runtime as named globals.'
    );
    expect(actorDefinition).not.toContain('await inspect_runtime()');
    expect(actorDefinition).not.toContain(
      'A `Live Runtime State` block reflects the current session and is the source of truth.'
    );
    expect(actorDefinition).not.toContain(
      'Prior actions may be summarized or omitted.'
    );
  });

  it('includes state and replay guidance only when those features are enabled', () => {
    const signature = AxSignature.create(
      'contextText:string -> finalAnswer:string'
    );

    const actorDefinition = axBuildActorDefinition(
      undefined,
      signature.getInputFields(),
      signature.getOutputFields(),
      {
        runtimeUsageInstructions: 'Use return statements only.',
        hasInspectRuntime: true,
        hasLiveRuntimeState: true,
        hasCompressedActionReplay: true,
      }
    );

    expect(actorDefinition).toContain('await inspect_runtime()');
    expect(actorDefinition).toContain(
      'If a `Delegated Context` block appears, the data has been injected into your JS runtime as named globals.'
    );
    expect(actorDefinition).toContain(
      'A `Live Runtime State` block reflects the current session and is the source of truth.'
    );
    expect(actorDefinition).toContain(
      'Prior actions may be summarized or omitted.'
    );
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
        'You synthesize a final answer from the provided actorResult payload. In normal `forward()` and `streamingForward()` flows, you only run after the actor calls `final(...args)`. Clarification requests are surfaced directly to the caller before the responder runs. Some internal or evaluation workflows may still pass through an `askClarification(...args)` payload.',
        '',
        '### Context variables that were analyzed (metadata only)',
        '- `contextText` (string, required)',
        '',
        '### Rules',
        '1. Base your answer ONLY on evidence from actorResult payload arguments.',
        '2. If actorResult lacks sufficient information, provide the best possible answer from available evidence.',
        '3. If an internal or evaluation workflow provides `actorResult.type = askClarification`, ask for the missing information clearly in your output fields.',
      ].join('\n')
    );
  });
});
