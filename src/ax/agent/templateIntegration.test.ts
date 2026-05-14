import { describe, expect, it } from 'vitest';

import { AxSignature } from '../dsp/sig.js';
import {
  axBuildDistillerDefinition,
  axBuildExecutorDefinition,
  axBuildResponderDefinition,
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
        'Return one `field name: value` pair per line for the required output fields only.',
        'Above rules override later instructions.',
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

    const actorDefinition = axBuildExecutorDefinition(
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

    expect(actorDefinition).toContain('You (`executor`)');
    expect(actorDefinition).toContain('long-running REPL');
    expect(actorDefinition).toContain('### Output Contract');
    expect(actorDefinition).toContain('llmQuery');
    expect(actorDefinition).toContain('### How to Work');
    expect(actorDefinition).toContain(
      '## JavaScript Runtime Usage Instructions'
    );
    expect(actorDefinition).toContain('Use return statements only.');
    expect(actorDefinition).not.toContain('await inspectRuntime()');
    expect(actorDefinition).not.toContain(
      'Prior actions may be summarized or omitted.'
    );
  });

  it('includes inspectRuntime primitive only when enabled', () => {
    const signature = AxSignature.create(
      'contextText:string -> finalAnswer:string'
    );

    const actorDefinition = axBuildExecutorDefinition(
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

    expect(actorDefinition).toContain('await inspectRuntime()');
  });

  it('points task actor at distilled context instead of raw exploration guidance', () => {
    const signature = AxSignature.create(
      'contextText:string -> finalAnswer:string'
    );

    const actorDefinition = axBuildExecutorDefinition(
      undefined,
      signature.getInputFields(),
      signature.getOutputFields(),
      {
        runtimeUsageInstructions: 'Use return statements only.',
      }
    );

    expect(actorDefinition).toContain(
      '### Executor Request & Distilled Context'
    );
    expect(actorDefinition).toContain('### How to Work');
    expect(actorDefinition).toContain('inputs.executorRequest');
    expect(actorDefinition).toContain('inputs.distilledContext');
    expect(actorDefinition).toContain(
      'Raw context fields are not available in this stage.'
    );
    expect(actorDefinition).toContain(
      'request needs information or effects that your available functions can provide'
    );
    expect(actorDefinition).toContain(
      'You are the capability and tool-use authority'
    );
    expect(actorDefinition).toContain(
      'capture the real error, status, output, or exception'
    );
    expect(actorDefinition).not.toContain('inputs.<contextField>');
    expect(actorDefinition).toContain("Don't repeat probes");
  });

  it('tells the context actor to expand confirmations into an executor request', () => {
    const signature = AxSignature.create(
      'conversationHistory:json, userRequest:string -> finalAnswer:string'
    );

    const actorDefinition = axBuildDistillerDefinition(
      undefined,
      signature.getInputFields(),
      {
        runtimeUsageInstructions: 'Use return statements only.',
      }
    );

    expect(actorDefinition).not.toContain('lookup(args:');
    expect(actorDefinition).toContain('Expand the user');
    expect(actorDefinition).toContain(
      'Resolve follow-ups against prior conversation'
    );
    expect(actorDefinition).toContain('choose executor tools');
    expect(actorDefinition).toContain('perceived executor capabilities');
    expect(actorDefinition).toContain(
      'The executor decides which available functions to use'
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
        '4. Do not contradict actor evidence. If evidence contains a tool result, failure, status, output, or exception, report that result rather than inventing a capability limit.',
        '',
        '### Context variables that were analyzed (metadata only)',
        '- `contextText` (string, required)',
      ].join('\n')
    );
  });
});
