import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  renderTemplateContent,
  validatePromptTemplateSyntax,
} from '../../../src/ax/agent/templateEngine.js';
import { AxPromptTemplate } from '../../../src/ax/dsp/prompt.js';
import { AxSignature, f, fn } from '../../../src/ax/dsp/sig.js';
import {
  goldenValue,
  NumberLiteral,
  restoreNumberLiterals,
} from './number-literals.js';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

type Fixture = Record<string, Json>;

const outDir = join(
  process.env.AXIR_CONFORMANCE_OUT_ROOT ?? process.cwd(),
  'ir/conformance/prompt'
);

// Input values keep their key order: prompts render object values in insertion
// order, so sorting them would no longer match the golden.
function stable(value: unknown, parentKey = '', keepOrder = false): unknown {
  if (value instanceof NumberLiteral) return value;
  if (Array.isArray(value)) {
    return value.map((item) => stable(item, parentKey, keepOrder));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const ordered =
      keepOrder ||
      parentKey === 'inputs' ||
      parentKey === 'outputs' ||
      parentKey === 'fields'
        ? entries
        : entries.sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(
      ordered.map(([key, item]) => [
        key,
        stable(item, key, keepOrder || key === 'input'),
      ])
    );
  }
  return value;
}

function writeFixture(name: string, fixture: Fixture): void {
  writeFileSync(
    join(outDir, `${name}.json`),
    `${restoreNumberLiterals(JSON.stringify(stable({ name, ...fixture }), null, 2))}\n`
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
    expected_messages: promptMessages(sig, goldenValue(input), options),
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
  'complex-output-includes-output-contract',
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

const instructedPrompt = new AxPromptTemplate(complexSig, {
  functions: [search],
});
instructedPrompt.setInstruction('Prioritize verified facts from search.');
writeFixture('instruction-retains-complete-output-contract', {
  kind: 'prompt',
  signature_spec: {
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
  input: { document: 'Ada Lovelace <ada@example.com>' },
  instruction: 'Prioritize verified facts from search.',
  tools: [
    {
      name: 'search',
      description: 'Search docs',
      args: { query: { type: 'string' } },
      result: {},
    },
  ],
  expected_messages: instructedPrompt.render(
    { document: 'Ada Lovelace <ada@example.com>' },
    {}
  ) as Json,
});

const instructionLifecycleSig = AxSignature.create(
  '"Base task description" question:string -> exactAnswer:string'
);
const clearedInstructionPrompt = new AxPromptTemplate(instructionLifecycleSig);
clearedInstructionPrompt.setInstruction('   ');
writeFixture('instruction-cleared-preserves-output-contract', {
  kind: 'prompt',
  signature: '"Base task description" question:string -> exactAnswer:string',
  input: { question: 'What is Ax?' },
  instruction: '   ',
  expected_messages: clearedInstructionPrompt.render(
    { question: 'What is Ax?' },
    {}
  ) as Json,
});

const deduplicatedInstructionPrompt = new AxPromptTemplate(
  instructionLifecycleSig
);
deduplicatedInstructionPrompt.setInstruction('Base task description');
writeFixture('instruction-deduplicates-signature-description', {
  kind: 'prompt',
  signature: '"Base task description" question:string -> exactAnswer:string',
  input: { question: 'What is Ax?' },
  instruction: 'Base task description',
  expected_messages: deduplicatedInstructionPrompt.render(
    { question: 'What is Ax?' },
    {}
  ) as Json,
});

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

stringPrompt(
  'value-descriptions',
  'ticket:string -> urgent:boolean(true "Core task blocked", false "Routine") "Urgent?", team:class "support, billing"(support "Help", billing "Invoices")',
  { ticket: 'Checkout is down' }
);
stringPrompt(
  'nested-value-descriptions',
  'ticket:string -> analysis:object{ urgent:boolean(true "Core task blocked"), teams:class[] "support, billing"(billing "Invoices") }',
  { ticket: 'Checkout is down' }
);

// Field titles follow TS's toTitle (src/ax/dsp/sig.ts): a snake_case name keeps
// its later words lowercase ("Generator answer"), a camelCase name starts a
// word at each capital ("Key Insight") but keeps a run of capitals together
// ("User ID", "Parse HTTP Response"), a digit run starts a word ("Item 123"),
// and words are separated by one space ("Field 2").
stringPrompt(
  'field-titles-snake-and-camel-case',
  'generator_answer:string, question_context:string, snake_case_name:string, keyInsight:string, item1:string, item123:string, field_2:string, step2Result:string, x2Y:string, value99Count:string, userID:string, apiURL:string, orderID:string, parseHTTPResponse:string -> root_cause:string, errorIdentification:string',
  {
    generator_answer: 'Paris',
    question_context: 'European capitals',
    snake_case_name: 'snake',
    keyInsight: 'Cite the source',
    item1: 'first',
    item123: 'third',
    field_2: 'second field',
    step2Result: 'done',
    x2Y: 'axis',
    value99Count: '99',
    userID: 'u-1',
    apiURL: 'https://example.com',
    orderID: 'o-7',
    parseHTTPResponse: 'ok',
  }
);

// JSON and array outputs keep the `field name: value` text contract: TS asks
// for one JSON object (and prints its shape) only when an output is an object
// or an array of objects.
stringPrompt(
  'json-and-array-outputs-text-contract',
  'question:string -> tags:string[], details:json',
  { question: 'What is Ax?' }
);

// Object input values render as JSON.stringify(value, null, 2): two-space
// indentation, keys in insertion order, {} and [] for empty containers, and
// non-ASCII text (including non-BMP emoji) as UTF-8 rather than \u escapes.
stringPrompt('json-input-pretty-json', 'plan:json -> answer:string', {
  plan: {
    zeta: 'Café ☕ naïve',
    alpha: { steps: [1, 2.5, { deep: 'ok' }], empty: {}, none: [] },
    emoji: 'Launch 🚀',
    flags: [true, false, null],
    count: 3,
  },
});

// Audio inputs: a plain string, and an audio object with a transcript (what an
// AxGen audio output renders to), reach the model as text; audio without a
// transcript is an audio part with only its format (wav when it has none) and
// its data.
stringPrompt(
  'audio-input-transcript-as-text',
  'speech:audio -> summary:string',
  {
    speech: {
      data: 'SUQzBAA=',
      format: 'mp3',
      mimeType: 'audio/mpeg',
      transcript: 'Hello there',
    },
  }
);
stringPrompt(
  'audio-input-plain-string-as-text',
  'speech:audio -> summary:string',
  { speech: 'Hello there' }
);
stringPrompt(
  'audio-input-object-as-audio-part',
  'question:string, speech:audio -> summary:string',
  {
    question: 'What is said?',
    speech: { data: 'SUQzBAA=', format: 'mp3', mimeType: 'audio/mpeg' },
  }
);
stringPrompt(
  'audio-input-format-defaults-to-wav',
  'speech:audio -> summary:string',
  { speech: { data: 'UklGRg==' } }
);
stringPrompt(
  'audio-input-array-as-audio-parts',
  'clips:audio[] -> summary:string',
  { clips: [{ data: 'SUQzBAA=', format: 'mp3' }, { data: 'UklGRg==' }] }
);

// Numbers in prompt JSON render as JSON.stringify writes them (Number's
// toString): shortest round-trip digits, integral values without ".0",
// exponent form only below 1e-6 and from 1e21 up (1e-7, 1e+21), and -0 as 0.
// Top-level number fields render the same way. The literals keep 2.0, -0.0,
// 1e16 and 1.152921504606847e18 as floats in the runners' JSON parsers.
stringPrompt(
  'json-input-number-format',
  'plan:json, budget:number -> answer:string',
  {
    plan: {
      values: [
        0,
        new NumberLiteral('-0.0'),
        new NumberLiteral('2.0'),
        2.5,
        -1234.56789,
        1234.56789,
        12345678.9,
        0.30000000000000004,
        0.0001,
        0.00001,
        0.000001,
        1e-7,
        1.5e-7,
        5e-324,
        new NumberLiteral('1e16'),
        9007199254740994,
        new NumberLiteral('1.152921504606847e18'),
        123456789012345680000,
        1e21,
        1.7976931348623157e308,
      ],
    },
    budget: 12345678.9,
  }
);

// String(x) and JSON.stringify(x) for numbers each runner parses from `input`
// with its own float parser. That reaches values a JSON fixture cannot hold:
// NaN and the infinities (JSON null, String "NaN" / "Infinity") and -0 ("0").
// Runners check `string` against their string.str intrinsic and `json`
// against every JSON encoder they use (compact, key-sorted, pretty, wire).
const numberFormatInputs = [
  '0',
  '-0',
  '2',
  '2.0',
  '-2',
  '2.5',
  '0.1',
  '0.30000000000000004',
  '4.35',
  '100',
  '1234.56789',
  '-1234.56789',
  '12345678.9',
  '0.0001',
  '0.00001',
  '0.000001',
  '0.0000015',
  '1e-7',
  '1.5e-7',
  '-1e-7',
  '1.2345678901234567e-7',
  '123e-20',
  '1e16',
  '1e20',
  '9.999999999999999e20',
  '1e21',
  '-1e21',
  '1.5e21',
  '123456789012345680000',
  '9007199254740993',
  '9007199254740994',
  '1152921504606846976',
  '5e-324',
  '2.2250738585072014e-308',
  '1.7976931348623157e308',
  '1e300',
  'NaN',
  'Infinity',
  '-Infinity',
];
writeFixture('number-format-cases', {
  kind: 'number_format',
  cases: numberFormatInputs.map((input) => {
    const value = Number(input);
    return { input, string: String(value), json: JSON.stringify(value) };
  }),
});

// string.format fills each {} from left to right with the next argument's
// text and string.str writes one value's text, in every port as JavaScript
// writes it: String(x) for a string, number, boolean or null, JSON.stringify(x)
// for a list or object (keys in insertion order). {{ and }} write one brace,
// any other brace is kept, an argument goes in as is, and a {} past the last
// argument stays {}. Each case's `input` keeps its key order in the file.
const jsValueText = (value: unknown): string =>
  value !== null && typeof value === 'object'
    ? JSON.stringify(value)
    : String(value);
function jsTemplateText(template: string, args: readonly unknown[]): string {
  let out = '';
  let next = 0;
  for (let index = 0; index < template.length; ) {
    const pair = template.slice(index, index + 2);
    if (pair === '{{') {
      out += '{';
      index += 2;
    } else if (pair === '}}') {
      out += '}';
      index += 2;
    } else if (pair === '{}') {
      out += next < args.length ? jsValueText(args[next++]) : '{}';
      index += 2;
    } else {
      out += template[index];
      index += 1;
    }
  }
  return out;
}
const stringFormatCases: { template: string; input: unknown[] }[] = [
  { template: 'Function not found: {}.', input: [null] },
  { template: '{} and {}', input: [true, false] },
  { template: '{} {} {} {}', input: [0, 2, 1.5, -12.25] },
  { template: 'list {}', input: [[1, 'x', null, true]] },
  { template: 'object {}', input: [{ query: 'scope-probe', limit: 2 }] },
  { template: 'nested {}', input: [{ z: [1, { a: null }], a: 'b' }] },
  {
    template: 'Field "{}": unbalanced "{" in object type',
    input: ['profile'],
  },
  {
    template: "type 'object ({{ mimeType: string; data: string }})' for {}",
    input: ['sourceFile'],
  },
  { template: '{{}} is literal, {} fills', input: ['x'] },
  { template: 'as is: {} then {}', input: ['a{}b', 'c'] },
  { template: 'one {} and {}', input: ['arg'] },
  { template: 'text {} ✓', input: ['é "quoted"\n'] },
];
const stringStrInputs: unknown[] = [
  null,
  true,
  false,
  0,
  1.5,
  'text',
  [1, 'a', null],
  { b: 1, a: [null, false] },
];
writeFixture('string-format-cases', {
  kind: 'string_format',
  format_cases: stringFormatCases.map((item) => ({
    template: item.template,
    input: item.input,
    expected: jsTemplateText(item.template, item.input),
  })),
  str_cases: stringStrInputs.map((input) => ({
    input,
    expected: jsValueText(input),
  })),
});
