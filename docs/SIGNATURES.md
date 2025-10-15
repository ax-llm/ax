# The Complete Guide to DSPy Signatures in Ax

## Introduction: Why Signatures Beat Prompts

Traditional prompt engineering is like writing assembly code – tedious, fragile, and requires constant tweaking. DSPy signatures are like high-level programming – you describe **what** you want, not **how** to get it.

### The Problem with Prompts

```typescript
// ❌ Traditional approach - fragile and verbose
const prompt = `You are a sentiment analyzer. Given a customer review, 
analyze the sentiment and return exactly one of: positive, negative, or neutral.
Be sure to only return the sentiment word, nothing else.

Review: ${review}
Sentiment:`;

// Hope the LLM follows instructions...
```

### The Power of Signatures

```typescript
// ✅ Signature approach - clear and type-safe
const analyzer = ax('review:string -> sentiment:class "positive, negative, neutral"');

// Guaranteed structured output with TypeScript types!
const result = await analyzer.forward(llm, { review });
console.log(result.sentiment); // TypeScript knows this is "positive" | "negative" | "neutral"
```

## Understanding Signature Syntax

A signature defines the contract between your code and the LLM:

```
[description] input1:type, input2:type -> output1:type, output2:type
```

### Basic Structure

1. **Optional Description**: Overall purpose in quotes
2. **Input Fields**: What you provide to the LLM
3. **Arrow (`->`)**: Separates inputs from outputs  
4. **Output Fields**: What the LLM returns

### Examples

```typescript
// Simple Q&A
'userQuestion:string -> aiAnswer:string'

// With description
'"Answer questions about TypeScript" question:string -> answer:string, confidence:number'

// Multiple inputs and outputs
'document:string, query:string -> summary:string, relevantQuotes:string[]'
```

## Field Types Reference

Ax supports a rich type system that maps directly to TypeScript types:

### Basic Types

| Type | Signature Syntax | TypeScript Type | Example |
|------|-----------------|-----------------|---------|
| String | `:string` | `string` | `userName:string` |
| Number | `:number` | `number` | `score:number` |
| Boolean | `:boolean` | `boolean` | `isValid:boolean` |
| JSON | `:json` | `any` | `metadata:json` |

### Date and Time Types

| Type | Signature Syntax | TypeScript Type | Example |
|------|-----------------|-----------------|---------|
| Date | `:date` | `Date` | `birthDate:date` |
| DateTime | `:datetime` | `Date` | `timestamp:datetime` |

### Media Types (Input Only)

| Type | Signature Syntax | TypeScript Type | Example |
|------|-----------------|-----------------|---------|
| Image | `:image` | `{mimeType: string, data: string}` | `photo:image` |
| Audio | `:audio` | `{format?: 'wav', data: string}` | `recording:audio` |
| File | `:file` | `{mimeType: string, data: string}` | `document:file` |
| URL | `:url` | `string` | `website:url` |

### Special Types

| Type | Signature Syntax | TypeScript Type | Example |
|------|-----------------|-----------------|---------|
| Code | `:code` | `string` | `pythonScript:code` |
| Classification | `:class "opt1, opt2"` | `"opt1" \| "opt2"` | `mood:class "happy, sad, neutral"` |

## Arrays and Optional Fields

### Arrays
Add `[]` after any type to make it an array:

```typescript
// String array
'tags:string[] -> processedTags:string[]'

// Number array
'scores:number[] -> average:number, median:number'

// Classification array
'documents:string[] -> categories:class[] "news, blog, tutorial"'
```

### Optional Fields
Add `?` before the colon to make a field optional:

```typescript
// Optional input
'query:string, context?:string -> response:string'

// Optional output
'text:string -> summary:string, keywords?:string[]'

// Both optional
'message?:string -> reply?:string, confidence:number'
```

## Advanced Features

### Internal Fields (Output Only)
Use `!` to mark output fields as internal (for reasoning/chain-of-thought):

```typescript
// Internal fields are hidden from the final output but guide LLM reasoning
'problem:string -> reasoning!:string, solution:string'
```

### Classification Fields (Output Only)
Classifications provide type-safe enums:

```typescript
// Single classification
'email:string -> priority:class "urgent, normal, low"'

// Multiple options with pipe separator
'text:string -> sentiment:class "positive | negative | neutral"'

// Array of classifications
'reviews:string[] -> sentiments:class[] "positive, negative, neutral"'
```

## Creating Signatures: Three Approaches

### 1. String-Based (Recommended)

```typescript
import { ax, s } from '@ax-llm/ax';

// Direct generator creation
const generator = ax('input:string -> output:string');

// Create signature first, then generator
const sig = s('query:string -> response:string');
const gen = ax(sig.toString());
```

### 2. Pure Fluent Builder API

```typescript
import { f } from '@ax-llm/ax';

// Using the pure fluent builder - only supports .optional(), .array(), .internal()
const signature = f()
  .input('userMessage', f.string('User input'))
  .input('contextData', f.string('Additional context').optional())
  .input('tags', f.string('Keywords').array())
  .input('categories', f.string('Categories').optional().array())
  .output('responseText', f.string('AI response'))
  .output('confidenceScore', f.number('Confidence score 0-1'))
  .output('debugInfo', f.string('Debug information').internal())
  .build();
```

### 3. Hybrid Approach

```typescript
import { s, f } from '@ax-llm/ax';

// Start with string, add fields programmatically
const sig = s('base:string -> result:string')
  .appendInputField('extra', f.optional(f.json('Metadata')))
  .appendOutputField('score', f.number('Quality score'));
```

### 4. Reusing Zod Schemas

```typescript
import { AxSignature } from '@ax-llm/ax';
import { z } from 'zod';

const inputSchema = z.object({
  query: z.string().describe('Search query text'),
  limit: z.number().int().max(10).optional(),
  tags: z.array(z.string()).optional(),
});

const outputSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string().url(),
    })
  ),
  status: z.enum(['success', 'failure']),
});

const signature = AxSignature.fromZod({
  description: 'Search knowledge base documents',
  input: inputSchema,
  output: outputSchema,
});
```

> `AxSignature.fromZod` covers the common Zod v4 primitives and warns whenever a field must be downgraded (for example, to `json`). Inputs use `z.input<>`, outputs use `z.output<>`, so you keep end-to-end type safety without duplicating schema definitions.

**Mapping highlights**

- `z.string()`, `z.number()`, `z.boolean()`, `z.date()` map to matching Ax field types. String refinements such as `.url()` and `.datetime()` become `url`/`datetime` field types.
- `z.array()` becomes Ax arrays; nested arrays fall back to `json`.
- Literal unions/`z.enum`/`z.nativeEnum` values become classifications; input unions are exposed as `string` fields with `options` metadata (Ax intentionally disallows `class` inputs).
- Optional/nullable/default/catch wrappers automatically mark the field optional.
- Records, maps, discriminated unions, and other dynamic structures stay as `json`, but Ax marks them as **downgraded** so you can adjust the schema (or rely on `strict: true`).

**Downgrades & strict mode**

- Ax emits a console warning (once per conversion) when a field cannot be represented exactly. Pass `{ warnOnFallback: false }` to silence the warning.
- Use `{ strict: true }` to throw if any field would be downgraded. The optional `onIssues` callback receives detailed metadata for custom logging or metrics.

```typescript
const signature = AxSignature.fromZod(
  {
    input: inputSchema,
    output: outputSchema,
  },
  {
    strict: false,
    onIssues: (issues) => {
      if (issues.length > 0) {
        console.warn('Downgraded Zod fields', issues);
      }
    },
  }
);

// Issues are stored on the signature instance for later inspection.
signature.getZodConversionIssues();

// Emit a human-friendly summary (console.warn by default)
signature.reportZodConversionIssues();
```

Need a quick readout before wiring it in? Call
`AxSignature.debugZodConversion({ input, output })` to get both the signature
and a ready-made downgrade report.

**Standard Schema?**

Standard Schema libraries (Effect Schema, Valibot, ArkType, etc.) publish adapters to Zod or JSON Schema. Convert with your preferred tool (for example [`xsschema`](https://xsai.js.org/docs/packages-top/xsschema)) and feed the resulting Zod schema into `AxSignature.fromZod`.

## Pure Fluent API Reference

The fluent API has been redesigned to be purely fluent, meaning you can only use method chaining with `.optional()`, `.array()`, and `.internal()` methods. Nested function calls are no longer supported.

### ✅ Pure Fluent Syntax (Current)

```typescript
import { f } from '@ax-llm/ax';

// Basic field types
const stringField = f.string('description');
const numberField = f.number('description');
const booleanField = f.boolean('description');

// Array types - use .array() method chaining
const stringArray = f.string('array description').array();
const numberArray = f.number('array description').array();
const booleanArray = f.boolean('array description').array();

// Optional fields - use .optional() method chaining
const optionalString = f.string('optional description').optional();
const optionalArray = f.string('optional array').optional().array();
const arrayOptional = f.string('array optional').array().optional(); // Same as above

// Internal fields (output only) - use .internal() method chaining
const internalField = f.string('internal description').internal();
const internalArray = f.string('internal array').array().internal();

// Complex combinations
const complexField = f.string('complex field')
  .optional()  // Make it optional
  .array()     // Make it an array
  .internal(); // Mark as internal (output only)
```

### ❌ Deprecated Nested Syntax (Removed)

```typescript
// These no longer work and will cause compilation errors
const badArray = f.array(f.string('description'));      // ❌ Removed
const badOptional = f.optional(f.string('description')); // ❌ Removed  
const badInternal = f.internal(f.string('description')); // ❌ Removed
```

### String vs Fluent API Equivalence

Both approaches create identical signatures:

```typescript
// String syntax
const stringSig = AxSignature.create(`
  userMessages:string[] "User messages",
  maxTokens?:number "Max tokens",
  enableDebug:boolean "Debug mode",
  categories?:string[] "Optional categories"
  ->
  responseText:string "Response",
  debugInfo!:string "Debug info"
`);

// Equivalent fluent syntax  
const fluentSig = f()
  .input('userMessages', f.string('User messages').array())
  .input('maxTokens', f.number('Max tokens').optional())
  .input('enableDebug', f.boolean('Debug mode'))
  .input('categories', f.string('Optional categories').optional().array())
  .output('responseText', f.string('Response'))
  .output('debugInfo', f.string('Debug info').internal())
  .build();

// Both create identical runtime structures and TypeScript types
console.log(stringSig.toString() === fluentSig.toString()); // true
```

### Type Inference and Arrays

The fluent API properly maps to TypeScript array types:

```typescript
// These all correctly infer TypeScript types
const sig = f()
  .input('strings', f.string('strings').array())           // string[]
  .input('numbers', f.number('numbers').array())           // number[]
  .input('booleans', f.boolean('booleans').array())        // boolean[]
  .input('optionalStrings', f.string('optional').optional().array()) // string[] | undefined
  .output('responseText', f.string('response'))            // string
  .build();

// TypeScript knows the exact types at compile time
type InputType = {
  strings: string[];
  numbers: number[];  
  booleans: boolean[];
  optionalStrings?: string[];
  responseText: string;
};
```

## Field Naming Best Practices

Ax enforces descriptive field names to improve LLM understanding:

### ✅ Good Field Names
- `userQuestion`, `customerEmail`, `documentText`
- `analysisResult`, `summaryContent`, `responseMessage`
- `confidenceScore`, `categoryType`, `priorityLevel`

### ❌ Bad Field Names (Will Error)
- `text`, `data`, `input`, `output` (too generic)
- `a`, `x`, `val` (too short)
- `1field`, `123name` (starts with number)

## Real-World Examples

### Email Classifier

```typescript
const emailClassifier = ax(`
  emailSubject:string "Email subject line",
  emailBody:string "Full email content" ->
  category:class "sales, support, spam, newsletter" "Email category",
  priority:class "urgent, normal, low" "Priority level",
  summary:string "Brief summary of the email"
`);

const result = await emailClassifier.forward(llm, {
  emailSubject: "Urgent: Server Down",
  emailBody: "Our production server is experiencing issues..."
});

console.log(result.category);  // "support"
console.log(result.priority);  // "urgent"
```

### Document Analyzer with Chain-of-Thought

```typescript
const analyzer = ax(`
  documentText:string "Document to analyze" ->
  reasoning!:string "Step-by-step analysis",
  mainTopics:string[] "Key topics discussed",
  sentiment:class "positive, negative, neutral, mixed" "Overall tone",
  readability:class "elementary, high-school, college, graduate" "Reading level",
  keyInsights:string[] "Important takeaways"
`);

// The reasoning field guides the LLM but isn't returned
const result = await analyzer.forward(llm, { 
  documentText: "..." 
});
// result.reasoning is undefined (internal field)
// result.mainTopics, sentiment, etc. are available
```

### Multi-Modal Analysis

```typescript
const imageAnalyzer = ax(`
  imageData:image "Image to analyze",
  question?:string "Specific question about the image" ->
  description:string "What's in the image",
  objects:string[] "Identified objects",
  textFound?:string "Any text detected in the image",
  answerToQuestion?:string "Answer if question was provided"
`);
```

### Data Extraction

```typescript
const extractor = ax(`
  invoiceText:string "Raw invoice text" ->
  invoiceNumber:string "Invoice ID",
  invoiceDate:date "Date of invoice",
  dueDate:date "Payment due date",
  totalAmount:number "Total amount due",
  lineItems:json[] "Array of {description, quantity, price}",
  vendor:json "{ name, address, taxId }"
`);
```

### Pure Fluent API Example

```typescript
import { f, ax } from '@ax-llm/ax';

// Complex signature using pure fluent API
const contentAnalyzer = f()
  .input('articleText', f.string('Article content to analyze'))
  .input('authorInfo', f.json('Author metadata').optional())
  .input('keywords', f.string('Target keywords').array())
  .input('checkFactuality', f.boolean('Enable fact-checking'))
  .output('mainThemes', f.string('Key themes').array())
  .output('sentimentScore', f.number('Sentiment score -1 to 1'))
  .output('readabilityLevel', f.class(['elementary', 'middle', 'high', 'college'], 'Reading level'))
  .output('factChecks', f.json('Fact checking results').array().optional())
  .output('processingTime', f.number('Analysis time in ms').internal())
  .description('Comprehensive article analysis with optional fact-checking')
  .build();

// Create generator from fluent signature
const generator = ax(contentAnalyzer.toString());

// Usage with typed inputs/outputs
const result = await generator.forward(llm, {
  articleText: 'Sample article content...',
  keywords: ['AI', 'machine learning', 'technology'],
  checkFactuality: true,
  // authorInfo is optional
});

// TypeScript knows exact types
console.log(result.mainThemes);        // string[]
console.log(result.sentimentScore);    // number
console.log(result.readabilityLevel);  // 'elementary' | 'middle' | 'high' | 'college'
console.log(result.factChecks);        // json[] | undefined (optional)
// result.processingTime is undefined (internal field)
```

## Streaming Support

All signatures support streaming by default:

```typescript
const storyteller = ax(`
  prompt:string "Story prompt",
  genre:class "fantasy, sci-fi, mystery, romance" ->
  title:string "Story title",
  story:string "The complete story",
  wordCount:number "Approximate word count"
`);

// Stream the response
for await (const chunk of storyteller.stream(llm, { 
  prompt: "A detective discovers their partner is a time traveler",
  genre: "mystery"
})) {
  if (chunk.story) {
    process.stdout.write(chunk.story); // Real-time streaming
  }
}
```

## Type Safety and IntelliSense

Signatures provide full TypeScript type inference:

```typescript
const typed = ax(`
  userId:number,
  includeDetails?:boolean ->
  userName:string,
  userEmail:string,
  metadata?:json
`);

// TypeScript knows the exact types
const result = await typed.forward(llm, {
  userId: 123,          // ✅ number required
  includeDetails: true  // ✅ boolean optional
  // userEmail: "..."   // ❌ TypeScript error: not an input field
});

console.log(result.userName);    // ✅ TypeScript knows this is string
console.log(result.metadata?.x); // ✅ TypeScript knows this is any | undefined
// console.log(result.userId);   // ❌ TypeScript error: not an output field
```

## Common Patterns

### 1. Chain of Thought Reasoning

```typescript
// Use internal fields for reasoning steps
const reasoner = ax(`
  problem:string ->
  thoughts!:string "Internal reasoning process",
  answer:string "Final answer"
`);
```

### 2. Structured Data Extraction

```typescript
// Extract structured data from unstructured text
const parser = ax(`
  messyData:string ->
  structured:json "Clean JSON representation"
`);
```

### 3. Multi-Step Classification

```typescript
// Hierarchical classification
const classifier = ax(`
  text:string ->
  mainCategory:class "technical, business, creative",
  subCategory:class "based on main category",
  confidence:number "0-1 confidence score"
`);
```

### 4. Validation and Checking

```typescript
// Validate and explain
const validator = ax(`
  code:code "Code to review",
  language:string "Programming language" ->
  isValid:boolean "Is the code syntactically correct",
  errors?:string[] "List of errors if any",
  suggestions?:string[] "Improvement suggestions"
`);
```

## Error Handling

Signatures provide clear, actionable error messages:

```typescript
// ❌ This will throw a descriptive error
try {
  const bad = ax('text:string -> result:string');
} catch (error) {
  // Error: Field name "text" is too generic. 
  // Use a more descriptive name like "inputText" or "documentText"
}

// ❌ Invalid type
try {
  const bad = ax('userInput:str -> result:string');
} catch (error) {
  // Error: Unknown type "str". Did you mean "string"?
}

// ❌ Duplicate field names
try {
  const bad = ax('data:string, data:number -> result:string');
} catch (error) {
  // Error: Duplicate field name "data" in inputs
}
```

## Migration from Traditional Prompts

### Before (Prompt Engineering)
```typescript
const prompt = `
Analyze the sentiment of the following review.
Rate it on a scale of 1-5.
Identify the main topics discussed.
Format your response as JSON with keys: rating, sentiment, topics

Review: ${review}
`;

const response = await llm.generate(prompt);
const parsed = JSON.parse(response); // Hope it's valid JSON...
```

### After (Signatures)
```typescript
const analyzer = ax(`
  review:string ->
  rating:number "1-5 rating",
  sentiment:class "very positive, positive, neutral, negative, very negative",
  topics:string[] "Main topics discussed"
`);

const result = await analyzer.forward(llm, { review });
// Guaranteed structure, no parsing needed!
```

## Performance Tips

1. **Use specific types**: `class` is more token-efficient than `string` for enums
2. **Leverage arrays**: Process multiple items in one call
3. **Optional fields**: Only request what you need
4. **Internal fields**: Use `!` for reasoning without returning it

## Conclusion

DSPy signatures in Ax transform LLM interactions from fragile prompt engineering to robust, type-safe programming. By describing what you want instead of how to get it, you can:

- Write more maintainable code
- Get guaranteed structured outputs
- Leverage TypeScript's type system
- Switch LLM providers without changing logic
- Build production-ready AI features faster

Start using signatures today and experience the difference!
