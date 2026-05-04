import { describe, expect, it } from 'vitest';

import { AxSignature } from '../dsp/sig.js';
import {
  axBuildActorDefinition,
  axBuildContextActorDefinition,
  axBuildResponderDefinition,
  axBuildTaskActorDefinition,
} from './rlm.js';
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
        '',
        '<task_definition>',
        'TASK',
        '</task_definition>',
        '',
        '<formatting_rules>',
        '',
        'These rules are mandatory and override later instructions.',
        'Return one `field name: value` pair per line for the required output fields only.',
        'Do not add surrounding prose, markdown, or code fences.',
        '',
        '</formatting_rules>',
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
      'You (`actor`) are a code generation agent'
    );
    expect(actorDefinition).toContain('long-running REPL');
    expect(actorDefinition).toContain(
      '- `contextText` -> `inputs.contextText` (string, required)'
    );
    expect(actorDefinition).toContain('### Responder Contract');
    expect(actorDefinition).toContain('llmQuery');
    expect(actorDefinition).toContain('### Exploration & Turn Discipline');
    expect(actorDefinition).toContain(
      '## JavaScript Runtime Usage Instructions'
    );
    expect(actorDefinition).toContain('Use return statements only.');
    expect(actorDefinition).toContain(
      'If a `Delegated Context` block appears, data is injected as named globals'
    );
    expect(actorDefinition).not.toContain('await inspect_runtime()');
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
      'If a `Delegated Context` block appears, data is injected as named globals'
    );
    expect(actorDefinition).toContain(
      '`liveRuntimeState` field is the source of truth'
    );
    expect(actorDefinition).toContain('Prior actions may be summarized');
  });

  it('points task actor at distilled context instead of raw exploration guidance', () => {
    const signature = AxSignature.create(
      'contextText:string -> finalAnswer:string'
    );

    const actorDefinition = axBuildTaskActorDefinition(
      undefined,
      signature.getInputFields(),
      signature.getOutputFields(),
      {
        hasDistilledContext: true,
        runtimeUsageInstructions: 'Use return statements only.',
      }
    );

    expect(actorDefinition).toContain(
      '### Executor Request & Distilled Context'
    );
    // Task actor receives pre-distilled context, so the raw-data exploration
    // section is omitted; only the lighter turn-discipline guidance remains.
    expect(actorDefinition).not.toContain('### Exploration & Turn Discipline');
    expect(actorDefinition).toContain('### Turn Discipline');
    expect(actorDefinition).toContain('inputs.executorRequest');
    expect(actorDefinition).toContain('inputs.distilledContext');
    expect(actorDefinition).toContain(
      'Raw context fields are not available in this task stage.'
    );
    expect(actorDefinition).toContain(
      'If the request needs information or effects that your available functions can provide'
    );
    expect(actorDefinition).not.toContain('inputs.<contextField>');
    expect(actorDefinition).toContain('do not repeat that code');
  });

  it('tells the context actor to expand confirmations into an executor request', () => {
    const signature = AxSignature.create(
      'conversationHistory:json, userRequest:string -> finalAnswer:string'
    );

    const actorDefinition = axBuildContextActorDefinition(
      undefined,
      signature.getInputFields(),
      {
        runtimeUsageInstructions: 'Use return statements only.',
      }
    );

    expect(actorDefinition).toContain('### Executor Request Contract');
    expect(actorDefinition).toContain(
      'A separate task executor will receive this request and has its own tools/functions.'
    );
    expect(actorDefinition).not.toContain('lookup(args:');
    expect(actorDefinition).toContain(
      'If the latest user message is a follow-up or confirmation'
    );
    expect(actorDefinition).toContain(
      'Avoid meta-requests like "determine whether the user affirmed"'
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
        'You synthesize the final answer from the evidence the actor gathered. You do not run code, call tools, or invoke agents — you read input fields and write the output fields.',
        '',
        "### Reading the actor's payload",
        '',
        '`Context Data` has two keys:',
        '',
        '- `task` — a one-line instruction telling you what to write into the output fields.',
        '- `evidence` — the data the actor curated for you to follow that instruction.',
        '',
        '### Rules',
        '',
        '1. Follow `Context Data.task` using `Context Data.evidence` and any other input fields provided.',
        "2. When emitting a JSON output field, write the value flat — do **not** wrap it under a key matching the field's title. The field is already named.",
        "3. If `evidence` lacks sufficient information, give the best possible answer from what's available across all input fields.",
        '',
        '### Context variables that were analyzed (metadata only)',
        '- `contextText` (string, required)',
      ].join('\n')
    );
  });
});
