import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  renderTemplateContent,
  validatePromptTemplateSyntax,
} from '../../../src/ax/agent/templateEngine.js';
import { AxPromptTemplate } from '../../../src/ax/dsp/prompt.js';
import { AxSignature, f, fn } from '../../../src/ax/dsp/sig.js';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

type Fixture = Record<string, Json>;

const outDir = join(process.cwd(), 'ir/conformance/prompt');

function stable(value: unknown, parentKey = ''): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stable(item, parentKey));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const ordered =
      parentKey === 'inputs' ||
      parentKey === 'outputs' ||
      parentKey === 'fields'
        ? entries
        : entries.sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(
      ordered.map(([key, item]) => [key, stable(item, key)])
    );
  }
  return value;
}

function writeFixture(name: string, fixture: Fixture): void {
  writeFileSync(
    join(outDir, `${name}.json`),
    `${JSON.stringify(stable({ name, ...fixture }), null, 2)}\n`
  );
}

function promptMessages(
  sig: AxSignature,
  input: Record<string, unknown>,
  options: ConstructorParameters<typeof AxPromptTemplate>[1] = {}
): Json {
  return new AxPromptTemplate(sig, options).render(input as any, {}) as Json;
}

function stringPrompt(
  name: string,
  signature: string,
  input: Record<string, unknown>,
  options: ConstructorParameters<typeof AxPromptTemplate>[1] = {},
  extra: Fixture = {}
): void {
  const sig = AxSignature.create(signature);
  const fixtureOptions = Object.fromEntries(
    Object.entries(options).filter(([key]) => key !== 'functions')
  );
  writeFixture(name, {
    kind: 'prompt',
    signature,
    input: input as Json,
    ...(Object.keys(fixtureOptions).length > 0
      ? { options: fixtureOptions as Json }
      : {}),
    ...extra,
    expected_messages: promptMessages(sig, input, options),
  });
}

function fluentPrompt(
  name: string,
  signatureSpec: Json,
  sig: AxSignature,
  input: Record<string, unknown>,
  options: ConstructorParameters<typeof AxPromptTemplate>[1] = {},
  extra: Fixture = {}
): void {
  const fixtureOptions = Object.fromEntries(
    Object.entries(options).filter(([key]) => key !== 'functions')
  );
  writeFixture(name, {
    kind: 'prompt',
    signature_spec: signatureSpec,
    input: input as Json,
    ...(Object.keys(fixtureOptions).length > 0
      ? { options: fixtureOptions as Json }
      : {}),
    ...extra,
    expected_messages: promptMessages(sig, input, options),
  });
}

function templateFixture(
  name: string,
  template: string,
  vars: Record<string, unknown>
): void {
  writeFixture(name, {
    kind: 'template',
    template,
    vars: vars as Json,
    expected_output: renderTemplateContent(template, vars),
  });
}

function templateErrorFixture(
  name: string,
  template: string,
  vars: Record<string, unknown>,
  expectedErrorContains: string
): void {
  writeFixture(name, {
    kind: 'template_error',
    template,
    vars: vars as Json,
    expected_error_contains: expectedErrorContains,
  });
}

function templateValidateFixture(
  name: string,
  template: string,
  requiredVariables: string[]
): void {
  writeFixture(name, {
    kind: 'template_validate',
    template,
    required_variables: requiredVariables,
    expected_result: validatePromptTemplateSyntax(
      template,
      'fixture-template',
      requiredVariables
    ) as Json,
  });
}

mkdirSync(outDir, { recursive: true });

stringPrompt(
  'default-basic',
  '"Answer the question" question:string -> answer:string',
  { question: 'What is Ax?' }
);

const search = fn('search')
  .description('Search docs')
  .arg('query', f.string('Search query'))
  .handler(() => ({ title: 'Docs' }))
  .build();

stringPrompt(
  'default-functions',
  '"Use tools when useful" question:string -> answer:string',
  { question: 'Where are the docs?' },
  { functions: [search] as any },
  {
    tools: [
      {
        name: 'search',
        description: 'Search docs',
        args: { query: { type: 'string', description: 'Search query' } },
        result: { title: 'Docs' },
      },
    ],
  }
);

const complexSig = f()
  .input('document', f.string('source document'))
  .output(
    'profile',
    f.object({
      displayName: f.string('display name'),
      email: f.string('email').optional(),
    })
  )
  .build();

fluentPrompt(
  'complex-output-omits-output-fields',
  {
    inputs: { document: { type: 'string', description: 'source document' } },
    outputs: {
      profile: {
        type: 'object',
        fields: {
          displayName: { type: 'string', description: 'display name' },
          email: { type: 'string', description: 'email', optional: true },
        },
      },
    },
  },
  complexSig,
  { document: 'Ada Lovelace <ada@example.com>' }
);

fluentPrompt(
  'structured-output-function-fallback',
  {
    inputs: { document: { type: 'string', description: 'source document' } },
    outputs: {
      profile: {
        type: 'object',
        fields: {
          displayName: { type: 'string', description: 'display name' },
          email: { type: 'string', description: 'email', optional: true },
        },
      },
    },
  },
  complexSig,
  { document: 'Ada Lovelace <ada@example.com>' },
  { structuredOutputFunctionName: 'final_result' }
);

const richSig = f()
  .description('Use $document to infer "sentiment" and [publishDate].')
  .input('document', f.string('raw source text'))
  .output('sentiment', f.class(['positive', 'negative'], 'sentiment class'))
  .output('publishDate', f.date('publish date'))
  .output('meetingTime', f.datetime('meeting time'))
  .output('validWindow', f.dateRange('valid date window'))
  .output('callWindow', f.datetimeRange('call window'))
  .build();

fluentPrompt(
  'field-references-class-date-ranges',
  {
    description: 'Use $document to infer "sentiment" and [publishDate].',
    inputs: { document: { type: 'string', description: 'raw source text' } },
    outputs: {
      sentiment: {
        type: 'class',
        description: 'sentiment class',
        options: ['positive', 'negative'],
      },
      publishDate: { type: 'date', description: 'publish date' },
      meetingTime: { type: 'datetime', description: 'meeting time' },
      validWindow: { type: 'dateRange', description: 'valid date window' },
      callWindow: { type: 'datetimeRange', description: 'call window' },
    },
  },
  richSig,
  { document: 'A launch note.' }
);

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
Return \`field name: value\` pairs.
</formatting_rules>`;

stringPrompt(
  'custom-template-reordered',
  '"Analyze the user query carefully" userQuery:string -> aiResponse:string "the result"',
  { userQuery: 'hello' },
  { customTemplate }
);

templateFixture('template-variables', 'Hello {{ user.name }}: {{ count }}', {
  user: { name: 'Ada' },
  count: 2,
});

templateFixture(
  'template-boolean-else',
  '{{ if enabled }}enabled{{ else }}disabled{{ /if }}',
  { enabled: false }
);

templateFixture(
  'template-string-equality',
  '{{ if mode === "fast" }}fast{{ else }}slow{{ /if }}',
  { mode: 'fast' }
);

templateFixture('template-comments', 'A{{ ! ignore this }}B', {});

templateErrorFixture(
  'template-missing-variable-error',
  'Hello {{ user.name }}',
  { user: {} },
  "Missing template variable 'user.name'"
);

templateErrorFixture(
  'template-invalid-tag-error',
  'Hello {{ user-name }}',
  {},
  "Invalid tag 'user-name'"
);

templateErrorFixture(
  'template-condition-type-error',
  '{{ if mode }}fast{{ /if }}',
  { mode: 'fast' },
  "Condition 'mode' must be boolean"
);

writeFixture('template-required-variable-preservation', {
  kind: 'template_error',
  operation: 'validate',
  template: '{{ identityText }}',
  required_variables: ['identityText', 'inputFieldsSection'],
  expected_error_contains:
    'must preserve template variable {{inputFieldsSection}}',
});

templateValidateFixture(
  'template-required-variable-valid',
  '{{ identityText }} {{ inputFieldsSection }}',
  ['identityText', 'inputFieldsSection']
);
