import { ai, ax, f } from '@ax-llm/ax';

// 1. Define a structured output signature with validation constraints
const sig = f()
  // Input validation: document must be between 10 and 10000 characters
  .input('document', f.string().min(10).max(10000))

  .output(
    'analysis',
    f.object({
      // Summary must be 50-500 characters
      summary: f.string('Brief summary of the document').min(50).max(500),

      // Entities array with validated fields
      entities: f
        .object({
          name: f.string().min(1).max(100), // Name: 1-100 chars
          type: f.class(['person', 'organization', 'location']),
          confidence: f.number().min(0).max(1), // Confidence: 0.0-1.0
        })
        .array(),

      // Metadata with format constraints
      metadata: f.object({
        sentiment: f.class(['positive', 'neutral', 'negative']),
        language: f
          .string()
          .regex('^[a-z]{2}$', 'Must be a 2-letter ISO 639-1 language code'), // e.g., "en", "es"
        wordCount: f.number().min(0),
      }),

      // Contact info with format validations
      contact: f.object({
        email: f.string().email(), // Must be valid email
        website: f.string().url().optional(), // Must be valid URL if provided
        username: f
          .string()
          .min(3)
          .max(20)
          .regex(
            '^[a-z0-9_]+$',
            'Must contain only lowercase letters, numbers, and underscores'
          ),
      }),

      // Tags: array of strings, each 2-30 characters
      tags: f.string().min(2).max(30).array(),

      // Timestamps with format hints
      createdAt: f.datetime(),
    })
  );

const extractData = ax(sig.build());

async function main() {
  if (!process.env.OPENAI_APIKEY) {
    console.error('Please set OPENAI_APIKEY environment variable');
    process.exit(1);
  }

  // 2. Initialize AI service
  const llm = ai({
    name: 'openai',
    apiKey: process.env.OPENAI_APIKEY,
  });

  const document = `
    Apple Inc. announced its new vision for AI integration at the WWDC event in Cupertino.
    CEO Tim Cook emphasized privacy and on-device processing as key priorities.
    The company's stock market value increased by 5% following the announcement.
    Analysts from various organizations praised the balanced approach to AI development.
  `;

  console.log('=== Structured Output with Validation Example ===\n');

  // Example 1: Valid input - document length is within 10-10000 chars
  console.log('1. Testing with VALID input (correct document length)...\n');
  try {
    const result = await extractData.forward(llm, { document });
    console.log('✓ Extraction successful!');
    console.log(JSON.stringify(result, null, 2));

    // Validation happens automatically on output
    console.log('\n--- Output Validation Summary ---');
    console.log(
      `✓ Summary length: ${result.analysis.summary.length} chars (required: 50-500)`
    );
    console.log(`✓ Entities found: ${result.analysis.entities.length}`);
    result.analysis.entities.forEach((entity: any, i: number) => {
      console.log(
        `  Entity ${i + 1}: ${entity.name} (${entity.type}) - confidence: ${entity.confidence}`
      );
    });
    console.log(
      `✓ Language code: ${result.analysis.metadata.language} (matches: ^[a-z]{2}$)`
    );
    console.log(
      `✓ Email: ${result.analysis.contact.email} (valid email format)`
    );
    console.log(
      `✓ Username: ${result.analysis.contact.username} (3-20 chars, lowercase alphanumeric)`
    );
    console.log(`✓ Tags: ${result.analysis.tags.join(', ')} (each 2-30 chars)`);
  } catch (error) {
    console.error('✗ Validation failed:', (error as Error).message);
  }

  // Example 2: Invalid input - document too short (< 10 chars)
  console.log('\n\n2. Testing with INVALID input (document too short)...\n');
  try {
    await extractData.forward(llm, { document: 'Short' });
    console.log('✗ Should have thrown validation error!');
  } catch (error) {
    console.log('✓ Input validation caught the error:');
    console.log(`  Error: ${(error as Error).message}`);
  }

  // Example 3: Demonstrate that output validation auto-retries with LLM
  console.log('\n\n3. Output Validation Features:');
  console.log('  - Validates LLM output against all constraints');
  console.log(
    '  - Auto-retries with correction instructions if validation fails'
  );
  console.log('  - Enforces:');
  console.log('    • String length constraints (min/max)');
  console.log('    • Number ranges (min/max)');
  console.log('    • Email format validation');
  console.log('    • URL format validation');
  console.log('    • Regex pattern matching');
  console.log('    • Nested object and array constraints');

  // Example 4: Top-level array output (Issue #432 fix demonstration)
  console.log('\n\n4. Testing Top-Level Array Output (Issue #432 fix)...\n');
  const arraySig = f()
    .input('inputText', f.string())
    .output(
      'items',
      f
        .object({
          id: f.number(),
          label: f.string(),
        })
        .array()
    );

  const extractArray = ax(arraySig.build());

  try {
    const arrayResult = await extractArray.forward(llm, {
      inputText: 'Item 1: Apple, Item 2: Banana, Item 3: Cherry',
    });
    console.log('✓ Array extraction successful!');
    console.log(JSON.stringify(arrayResult, null, 2));
  } catch (error) {
    console.error('✗ Array extraction failed:', (error as Error).message);
  }

  console.log('\n✓ All validation examples completed!');
}

main().catch(console.error);
