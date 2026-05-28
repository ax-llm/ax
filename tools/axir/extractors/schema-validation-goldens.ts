import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { validateStructuredOutputValues } from '../../../src/ax/dsp/extract/structuredJson.js';
import { toJsonSchema } from '../../../src/ax/dsp/jsonSchema.js';
import { type AxField, type AxSignature, f } from '../../../src/ax/dsp/sig.js';
import { validateValue } from '../../../src/ax/dsp/util.js';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Fixture = Record<string, Json>;

const schemaDir = join(process.cwd(), 'ir/conformance/schema');
const validationDir = join(process.cwd(), 'ir/conformance/validation');

function stable(value: unknown, parentKey = ''): unknown {
  if (Array.isArray(value)) return value.map((item) => stable(item, parentKey));
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

function writeFixture(dir: string, name: string, fixture: Fixture): void {
  writeFileSync(
    join(dir, `${name}.json`),
    `${JSON.stringify(stable({ name, ...fixture }), null, 2)}\n`
  );
}

function schemaCase(
  name: string,
  signatureSpec: Json,
  sig: AxSignature,
  target: 'inputs' | 'outputs' = 'outputs',
  options: Record<string, unknown> = {}
): void {
  const fields =
    target === 'inputs' ? sig.getInputFields() : sig.getOutputFields();
  writeFixture(schemaDir, name, {
    kind: 'json_schema',
    signature_spec: signatureSpec,
    target,
    ...(Object.keys(options).length > 0
      ? { schema_options: options as Json }
      : {}),
    expected_schema: toJsonSchema(fields, 'Schema', options) as Json,
  });
}

function validateValueCase(
  name: string,
  fieldSpec: Json,
  field: AxField,
  value: unknown
): void {
  validateValue(field, value as any);
  writeFixture(validationDir, name, {
    kind: 'validate_value',
    field_name: field.name,
    field: fieldSpec,
    value: value as Json,
    expected_ok: true,
  });
}

function validateValueErrorCase(
  name: string,
  fieldSpec: Json,
  field: AxField,
  value: unknown,
  expected: string
): void {
  try {
    validateValue(field, value as any);
    throw new Error('expected validation to fail');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes(expected)) {
      throw new Error(
        `${name}: expected TS error containing ${expected}, got ${message}`
      );
    }
    writeFixture(validationDir, name, {
      kind: 'validate_value',
      field_name: field.name,
      field: fieldSpec,
      value: value as Json,
      expected_error_category: 'validation',
      expected_error_contains: expected,
      ts_error_name: err instanceof Error ? err.name : 'Error',
      ts_error_message: message,
    });
  }
}

function validateOutputCase(
  name: string,
  signatureSpec: Json,
  sig: AxSignature,
  values: Record<string, unknown>
): void {
  const copy = structuredClone(values);
  validateStructuredOutputValues(sig, copy);
  writeFixture(validationDir, name, {
    kind: 'validate_output',
    signature_spec: signatureSpec,
    values: values as Json,
    expected_values: copy as Json,
  });
}

function validateOutputErrorCase(
  name: string,
  signatureSpec: Json,
  sig: AxSignature,
  values: Record<string, unknown>,
  expected: string
): void {
  try {
    validateStructuredOutputValues(sig, structuredClone(values));
    throw new Error('expected structured output validation to fail');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes(expected)) {
      throw new Error(
        `${name}: expected TS error containing ${expected}, got ${message}`
      );
    }
    writeFixture(validationDir, name, {
      kind: 'validate_output',
      signature_spec: signatureSpec,
      values: values as Json,
      expected_error_category: 'validation',
      expected_error_contains: expected,
      ts_error_name: err instanceof Error ? err.name : 'Error',
      ts_error_message: message,
    });
  }
}

function stripInternalCase(
  name: string,
  signatureSpec: Json,
  sig: AxSignature,
  values: Record<string, unknown>
): void {
  const expected = Object.fromEntries(
    sig
      .getOutputFields()
      .filter((field) => !field.isInternal && field.name in values)
      .map((field) => [field.name, values[field.name]])
  );
  writeFixture(validationDir, name, {
    kind: 'strip_internal',
    signature_spec: signatureSpec,
    values: values as Json,
    expected_output: expected as Json,
  });
}

mkdirSync(schemaDir, { recursive: true });
mkdirSync(validationDir, { recursive: true });

const primitiveSpec = {
  inputs: { query: { type: 'string' } },
  outputs: {
    answer: { type: 'string' },
    score: { type: 'number' },
    isRelevant: { type: 'boolean' },
    sentiment: { type: 'class', options: ['positive', 'negative'] },
  },
};
const primitiveSig = f()
  .input('query', f.string())
  .output('answer', f.string())
  .output('score', f.number())
  .output('isRelevant', f.boolean())
  .output('sentiment', f.class(['positive', 'negative'] as const))
  .build();
schemaCase('primitive-and-class-output', primitiveSpec, primitiveSig);

const optionalInternalSpec = {
  inputs: { query: { type: 'string' } },
  outputs: {
    publicField: { type: 'string' },
    optionalField: { type: 'string', optional: true },
    internalField: { type: 'string', internal: true },
  },
};
const optionalInternalSig = f()
  .input('query', f.string())
  .output('publicField', f.string())
  .output('optionalField', f.string().optional())
  .output('internalField', f.string().internal())
  .build();
schemaCase(
  'optional-and-internal-output',
  optionalInternalSpec,
  optionalInternalSig
);
schemaCase(
  'strict-optional-nullable',
  optionalInternalSpec,
  optionalInternalSig,
  'outputs',
  {
    strictStructuredOutputs: true,
  }
);

const constraintsSpec = {
  inputs: { query: { type: 'string' } },
  outputs: {
    username: { type: 'string', min: 3, max: 20 },
    email: { type: 'string', email: true },
    website: { type: 'string', url: true },
    outputCode: {
      type: 'string',
      pattern: '^[A-Z0-9]+$',
      patternDescription: 'Must contain only uppercase letters and numbers',
    },
    age: { type: 'number', min: 18, max: 120 },
  },
};
const constraintsSig = f()
  .input('query', f.string())
  .output('username', f.string().min(3).max(20))
  .output('email', f.string().email())
  .output('website', f.string().url())
  .output(
    'outputCode',
    f
      .string()
      .regex('^[A-Z0-9]+$', 'Must contain only uppercase letters and numbers')
  )
  .output('age', f.number().min(18).max(120))
  .build();
schemaCase('constraints-and-formats', constraintsSpec, constraintsSig);

const specialSpec = {
  inputs: {
    link: { type: 'url' },
  },
  outputs: {
    birthDate: { type: 'date' },
    timestamp: { type: 'datetime' },
    travelDates: { type: 'dateRange' },
    window: { type: 'datetimeRange' },
    speech: { type: 'audio', description: 'Short spoken answer' },
  },
};
const specialSig = f()
  .input('link', f.url())
  .output('birthDate', f.date())
  .output('timestamp', f.datetime())
  .output('travelDates', f.dateRange())
  .output('window', f.datetimeRange())
  .output('speech', f.audio('Short spoken answer'))
  .build();
schemaCase('special-types-output', specialSpec, specialSig);
schemaCase('special-types-input', specialSpec, specialSig, 'inputs');

const nestedSpec = {
  inputs: { query: { type: 'string' } },
  outputs: {
    user: {
      type: 'object',
      description: 'User profile',
      fields: {
        username: { type: 'string', min: 3, max: 20 },
        email: { type: 'string', email: true, optional: true },
        age: { type: 'number', min: 18, max: 120 },
      },
    },
  },
};
const nestedSig = f()
  .input('query', f.string())
  .output(
    'user',
    f.object(
      {
        username: f.string().min(3).max(20),
        email: f.string().email().optional(),
        age: f.number().min(18).max(120),
      },
      'User profile'
    )
  )
  .build();
schemaCase('nested-object-constraints', nestedSpec, nestedSig);

const arraySpec = {
  inputs: { query: { type: 'string' } },
  outputs: {
    tags: { type: 'string', min: 2, max: 30, array: true },
    reviews: {
      type: 'object',
      description: 'Review item',
      array: true,
      arrayDescription: 'List of reviews',
      fields: {
        rating: { type: 'number', min: 1, max: 5 },
        comment: { type: 'string', min: 10, max: 1000 },
      },
    },
  },
};
const arraySig = f()
  .input('query', f.string())
  .output('tags', f.string().min(2).max(30).array())
  .output(
    'reviews',
    f
      .object(
        {
          rating: f.number().min(1).max(5),
          comment: f.string().min(10).max(1000),
        },
        'Review item'
      )
      .array('List of reviews')
  )
  .build();
schemaCase('arrays-and-array-objects', arraySpec, arraySig);

const flexibleSpec = {
  inputs: { query: { type: 'string' } },
  outputs: {
    payloadData: { type: 'json', description: 'Flexible payload' },
    looseObject: { type: 'object', description: 'Loose object' },
  },
};
const flexibleSig = f()
  .input('query', f.string())
  .output('payloadData', f.json('Flexible payload'))
  .output('looseObject', f.object(undefined, 'Loose object'))
  .build();
schemaCase('flexible-json-default', flexibleSpec, flexibleSig);
schemaCase('flexible-json-as-string', flexibleSpec, flexibleSig, 'outputs', {
  flexibleJsonFieldsAsString: true,
});

validateValueCase(
  'value-string-valid',
  { type: 'string', min: 3 },
  f()
    .input('personName', f.string().min(3))
    .output('resultText', f.string())
    .build()
    .getInputFields()[0]!,
  'Ada'
);
validateValueErrorCase(
  'value-string-invalid-type',
  { type: 'string' },
  f()
    .input('personName', f.string())
    .output('resultText', f.string())
    .build()
    .getInputFields()[0]!,
  42,
  'Expected'
);
validateValueCase(
  'value-file-valid',
  { type: 'file' },
  f()
    .input('sourceFile', f.file())
    .output('resultText', f.string())
    .build()
    .getInputFields()[0]!,
  { filename: 'a.pdf', mimeType: 'application/pdf', data: 'AAAA' }
);
validateValueErrorCase(
  'value-file-invalid',
  { type: 'file' },
  f()
    .input('sourceFile', f.file())
    .output('resultText', f.string())
    .build()
    .getInputFields()[0]!,
  { mimeType: 'application/pdf' },
  'mimeType'
);

validateOutputCase('output-valid-nested', nestedSpec, nestedSig, {
  user: { username: 'adalovelace', email: 'ada@example.com', age: 36 },
});
validateOutputCase(
  'output-optional-null',
  optionalInternalSpec,
  optionalInternalSig,
  {
    publicField: 'shown',
    optionalField: null,
    internalField: 'scratch',
  }
);
validateOutputErrorCase(
  'output-missing-required',
  nestedSpec,
  nestedSig,
  {
    user: { email: 'ada@example.com', age: 36 },
  },
  'Required field is missing'
);
validateOutputErrorCase(
  'output-string-min',
  nestedSpec,
  nestedSig,
  {
    user: { username: 'Al', age: 36 },
  },
  'at least 3 characters'
);
validateOutputErrorCase(
  'output-number-minimum',
  nestedSpec,
  nestedSig,
  {
    user: { username: 'adalovelace', age: 12 },
  },
  'at least 18'
);
validateOutputErrorCase(
  'output-email-format',
  nestedSpec,
  nestedSig,
  {
    user: { username: 'adalovelace', email: 'not-email', age: 36 },
  },
  'valid email address'
);

stripInternalCase(
  'strip-internal-output',
  optionalInternalSpec,
  optionalInternalSig,
  {
    publicField: 'shown',
    optionalField: 'maybe',
    internalField: 'scratch',
  }
);
