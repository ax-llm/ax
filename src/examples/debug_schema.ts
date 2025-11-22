import { toJsonSchema } from '../../src/ax/dsp/jsonSchema.js';
import { f } from '../../src/ax/dsp/sig.js';

// Example showcasing validation constraints in JSON schema generation
const sig = f()
  .input('document', f.string().min(10).max(10000))
  .output(
    'analysis',
    f.object({
      // String with length constraints
      summary: f.string('Brief summary of the document').min(50).max(500),

      // Array of objects with constraints
      entities: f
        .object({
          name: f.string().min(1).max(100),
          type: f.class(['person', 'organization', 'location']),
          confidence: f.number().min(0).max(1), // 0-1 range for confidence score
        })
        .array(),

      // Nested object with various constraint types
      metadata: f.object({
        sentiment: f.class(['positive', 'neutral', 'negative']),
        language: f
          .string()
          .regex('^[a-z]{2}$', 'Must be a 2-letter ISO 639-1 language code'),
        wordCount: f.number().min(0),
      }),

      // String format validations
      contact: f.object({
        email: f.string().email(), // Email format validation
        website: f.string().url().optional(), // URL format validation (optional)
        username: f
          .string()
          .min(3)
          .max(20)
          .regex(
            '^[a-z0-9_]+$',
            'Must contain only lowercase letters, numbers, and underscores'
          ),
      }),

      // Array of primitives with constraints
      tags: f.string().min(2).max(30).array(),

      // Date/time fields with format hints
      createdAt: f.datetime(),
      publishDate: f.date().optional(),
    })
  );

const outputFields = sig.build().getOutputFields();
const schema = toJsonSchema(outputFields);

console.log('=== Generated JSON Schema with Validation Constraints ===\n');
console.log(JSON.stringify(schema, null, 2));

// Show specific constraint examples
console.log('\n=== Constraint Examples ===\n');
console.log('String length constraints:');
console.log(
  `  summary.minLength: ${(schema.properties?.analysis?.properties?.summary as any)?.minLength}`
);
console.log(
  `  summary.maxLength: ${(schema.properties?.analysis?.properties?.summary as any)?.maxLength}`
);

console.log('\nNumber range constraints:');
console.log(
  `  confidence.minimum: ${(schema.properties?.analysis?.properties?.entities?.items?.properties?.confidence as any)?.minimum}`
);
console.log(
  `  confidence.maximum: ${(schema.properties?.analysis?.properties?.entities?.items?.properties?.confidence as any)?.maximum}`
);

console.log('\nFormat validations:');
console.log(
  `  email.format: ${(schema.properties?.analysis?.properties?.contact?.properties?.email as any)?.format}`
);
console.log(
  `  website.format: ${(schema.properties?.analysis?.properties?.contact?.properties?.website as any)?.format}`
);
console.log(
  `  createdAt.format: ${(schema.properties?.analysis?.properties?.createdAt as any)?.format}`
);

console.log('\nRegex patterns:');
console.log(
  `  language.pattern: ${(schema.properties?.analysis?.properties?.metadata?.properties?.language as any)?.pattern}`
);
console.log(
  `  username.pattern: ${(schema.properties?.analysis?.properties?.contact?.properties?.username as any)?.pattern}`
);

console.log('\nArray item constraints:');
console.log(
  `  tags.items.minLength: ${(schema.properties?.analysis?.properties?.tags?.items as any)?.minLength}`
);
console.log(
  `  tags.items.maxLength: ${(schema.properties?.analysis?.properties?.tags?.items as any)?.maxLength}`
);
