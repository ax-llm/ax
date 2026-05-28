import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { AxSignature, f } from '../../../src/ax/dsp/sig.js';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Fixture = Record<string, Json>;

const outDir = join(process.cwd(), 'ir/conformance/signature');

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

function writeFixture(name: string, fixture: Fixture): void {
  writeFileSync(
    join(outDir, `${name}.json`),
    `${JSON.stringify(stable({ name, ...fixture }), null, 2)}\n`
  );
}

function title(name: string): string {
  const out: string[] = [];
  for (const [i, ch] of [...name.replaceAll('_', ' ')].entries()) {
    if (i > 0 && /[A-Z0-9]/.test(ch)) out.push(' ');
    out.push(ch);
  }
  const text = out.join('').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function normalizeField(field: any): Json {
  const out: Record<string, Json> = {
    name: field.name,
    title: field.title ?? title(field.name),
    type: normalizeType(field.type),
    isOptional: Boolean(field.isOptional),
    isInternal: Boolean(field.isInternal),
    isCached: Boolean(field.isCached),
  };
  if (field.description !== undefined) out.description = field.description;
  return out;
}

function normalizeNestedField(name: string, fieldType: any): Json {
  const out: Record<string, Json> = {
    name,
    title: title(name),
    type: normalizeType({
      name: fieldType.type ?? fieldType.name,
      isArray: fieldType.isArray,
      options: fieldType.options,
      fields: fieldType.fields,
      minLength: fieldType.minLength,
      maxLength: fieldType.maxLength,
      minimum: fieldType.minimum,
      maximum: fieldType.maximum,
      pattern: fieldType.pattern,
      patternDescription: fieldType.patternDescription,
      format: fieldType.format,
      description: fieldType.description,
    }),
    isOptional: Boolean(fieldType.isOptional),
    isInternal: Boolean(fieldType.isInternal),
    isCached: Boolean(fieldType.isCached),
  };
  if (fieldType.description !== undefined)
    out.description = fieldType.description;
  return out;
}

function normalizeType(type: any): Json {
  const out: Record<string, Json> = {
    name: type?.name ?? 'string',
    isArray: Boolean(type?.isArray),
  };
  if (type?.options) out.options = [...type.options];
  if (type?.description !== undefined) out.description = type.description;
  if (type?.fields) {
    out.fields = Object.fromEntries(
      Object.entries(type.fields).map(([name, fieldType]) => [
        name,
        normalizeNestedField(name, fieldType),
      ])
    ) as Json;
  }
  if (type?.minLength !== undefined) out.minLength = type.minLength;
  if (type?.maxLength !== undefined) out.maxLength = type.maxLength;
  if (type?.minimum !== undefined) out.minimum = type.minimum;
  if (type?.maximum !== undefined) out.maximum = type.maximum;
  if (type?.pattern !== undefined) out.pattern = type.pattern;
  if (type?.patternDescription !== undefined)
    out.patternDescription = type.patternDescription;
  if (type?.format !== undefined) out.format = type.format;
  return out;
}

function normalizeSignature(sig: AxSignature): Json {
  return {
    description: sig.getDescription() ?? null,
    inputs: sig.getInputFields().map(normalizeField),
    outputs: sig.getOutputFields().map(normalizeField),
  };
}

function stringCase(name: string, signature: string): void {
  writeFixture(name, {
    kind: 'signature',
    signature,
    expected_signature: normalizeSignature(AxSignature.create(signature)),
  });
}

function fluentCase(name: string, signatureSpec: Json, sig: AxSignature): void {
  writeFixture(name, {
    kind: 'signature',
    signature_spec: signatureSpec,
    expected_signature: normalizeSignature(sig),
  });
}

function errorCase(name: string, signature: string, expected: string): void {
  try {
    AxSignature.create(signature);
    throw new Error('expected signature construction to fail');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes(expected)) {
      throw new Error(
        `${name}: expected TS error containing ${expected}, got ${message}`
      );
    }
    writeFixture(name, {
      kind: 'signature_error',
      signature,
      expected_error_category: 'signature',
      expected_error_contains: expected,
      ts_error_name: err instanceof Error ? err.name : 'Error',
      ts_error_message: message,
    });
  }
}

mkdirSync(outDir, { recursive: true });

stringCase('default-string-type', 'question -> answer');
stringCase(
  'descriptions-and-single-quotes',
  'question:string "double quote", context:string \'single quote\' -> answer:string "result"'
);
stringCase(
  'arrays-optional-internal',
  'questions:string[], context?:string -> answer:string, notes?!:string'
);
stringCase(
  'class-comma-options',
  'documentText:string -> sentiment:class "positive, negative, neutral"'
);
stringCase(
  'class-pipe-options-array',
  'documentText:string -> labels:class[] "bug | feature | docs"'
);
stringCase(
  'output-audio-script',
  'documentText:string -> speechAudio:audio, summary:string'
);
stringCase('whitespace-trimming', '\t question:string  ->  answer:number \n');

fluentCase(
  'fluent-nested-object',
  {
    inputs: {
      user: {
        type: 'object',
        description: 'User profile',
        fields: {
          name: { type: 'string', description: 'User name', min: 2 },
          email: { type: 'string', email: true, optional: true },
        },
      },
    },
    outputs: {
      responseText: { type: 'string' },
    },
  },
  f()
    .input(
      'user',
      f.object(
        {
          name: f.string('User name').min(2),
          email: f.string().email().optional(),
        },
        'User profile'
      )
    )
    .output('responseText', f.string())
    .build()
);

fluentCase(
  'fluent-cache-and-constraints',
  {
    inputs: {
      document: { type: 'string', cache: true },
    },
    outputs: {
      rating: { type: 'number', min: 1, max: 5 },
      outputCode: {
        type: 'string',
        pattern: '^[A-Z0-9]+$',
        patternDescription: 'Uppercase letters and numbers only',
      },
    },
  },
  f()
    .input('document', f.string().cache())
    .output('rating', f.number().min(1).max(5))
    .output(
      'outputCode',
      f.string().regex('^[A-Z0-9]+$', 'Uppercase letters and numbers only')
    )
    .build()
);

errorCase(
  'error-missing-arrow',
  'question:string answer:string',
  'Expected "->"'
);
errorCase(
  'error-missing-output',
  'question:string ->',
  'No output fields specified'
);
errorCase(
  'error-invalid-type',
  'question:invalid -> answer:string',
  'Invalid type "invalid"'
);
errorCase(
  'error-unclosed-description',
  'question:string "unterminated -> answer:string',
  'Unterminated string'
);
errorCase(
  'error-extra-content',
  'question:string -> answer:string extra content',
  'Unexpected content after signature'
);
errorCase(
  'error-leading-number',
  '1question:string -> answer:string',
  'cannot start with a number'
);
errorCase(
  'error-duplicate-input',
  'question:string, question:number -> answer:string',
  'Duplicate input field name'
);
errorCase(
  'error-input-output-collision',
  'question:string -> question:string',
  'appears in both inputs and outputs'
);
errorCase(
  'error-input-class',
  'category:class "a, b" -> answer:string',
  'cannot use the "class" type'
);
errorCase(
  'error-input-internal',
  'question!:string -> answer:string',
  'cannot use the internal marker'
);
errorCase(
  'error-output-image',
  'question:string -> picture:image',
  'Image type is not supported in output fields'
);
errorCase(
  'error-output-audio-array',
  'question:string -> clips:audio[]',
  'Arrays of audio are not supported'
);
errorCase(
  'error-empty-class-options',
  'question:string -> category:class ""',
  'Missing class options'
);
