---
title: "DSPy Concepts"
description: "Signatures, field types, assertions, and optimization in Ax"
---

# DSPy Concepts

DSPy (Demonstrate-Search-Predict) is a framework from Stanford that replaces hand-written prompts with **signatures** — typed declarations of inputs and outputs. Ax implements DSPy in TypeScript with full streaming, validation, and automatic optimization.

Instead of writing prompts, you declare what goes in and what comes out. Ax generates the prompt, validates the output, and retries on failure.

## Your First Signature

```typescript
import { ai, ax } from '@ax-llm/ax';

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_APIKEY! });

// Declare inputs and outputs
const classifier = ax(
  'reviewText:string -> sentiment:class "positive, negative, neutral"'
);

const result = await classifier.forward(llm, {
  reviewText: 'This product exceeded my expectations!',
});
console.log(result.sentiment); // "positive"
```

The string `reviewText:string -> sentiment:class "positive, negative, neutral"` is a **signature**. Everything before `->` is an input, everything after is an output. Each field has a name and a type.

## Field Types

| Type | Description | Example |
|------|-------------|---------|
| `string` | Text | `name:string` |
| `number` | Integer or decimal | `score:number` |
| `boolean` | True/false | `isValid:boolean` |
| `date` | Date (YYYY-MM-DD) | `publishedOn:date` |
| `datetime` | Date and time | `createdAt:datetime` |
| `json` | Structured JSON object | `metadata:json` |
| `code` | Code block | `solution:code` |
| `class` | Enum classification | `mood:class "happy, sad, neutral"` |
| `url` | URL | `sourceLink:url` |
| `image` | Image (input only) | `photo:image` |
| `audio` | Audio (input only) | `recording:audio` |

### Modifiers

- **Optional**: `nickname?:string` — field may be omitted
- **Array**: `tags:string[]` — list of values
- **Internal**: `reasoning!:string` — generated but hidden from output (chain of thought)
- **Description**: `score:number "0 to 1"` — hint for the LLM in quotes

```typescript
// All modifiers in action
const gen = ax(`
  question:string ->
  reasoning!:string "step by step thinking",
  answer:string,
  confidence:number "0-1",
  sources?:url[],
  tags:string[] "relevant keywords"
`);
```

## Three Ways to Define Signatures

### 1. String-based (quick)

```typescript
import { ax } from '@ax-llm/ax';

const gen = ax('question:string -> answer:string, confidence:number');
```

### 2. Fluent builder (type-safe with constraints)

```typescript
import { AxGen, f } from '@ax-llm/ax';

const sig = f()
  .input('document', f.string('Text to analyze').min(10).max(10000))
  .output('summary', f.string('Brief summary').min(50).max(500))
  .output(
    'sentiment',
    f.class(['positive', 'neutral', 'negative'], 'Overall tone')
  )
  .output('confidence', f.number('Score 0-1').min(0).max(1))
  .output('tags', f.string('Keywords').array())
  .build();

const gen = new AxGen(sig);
```

### 3. Hybrid (extend a string signature with fluent fields)

```typescript
import { s, f, AxGen } from '@ax-llm/ax';

const sig = s('text:string -> summary:string')
  .appendOutputField('entities', f.object({
    name: f.string().min(1).max(100),
    type: f.class(['person', 'organization', 'location']),
    confidence: f.number().min(0).max(1),
  }).array());

const gen = new AxGen(sig);
```

## Validation Constraints

The fluent builder supports schema validation on fields. When the LLM output fails validation, Ax auto-retries with the error fed back into the prompt.

```typescript
const sig = f()
  .input('document', f.string().min(10).max(10000))
  .output('analysis', f.object({
    summary: f.string('Brief summary').min(50).max(500),
    entities: f.object({
      name: f.string().min(1).max(100),
      type: f.class(['person', 'organization', 'location']),
      confidence: f.number().min(0).max(1),
    }).array(),
    contact: f.object({
      email: f.string().email(),
      website: f.string().url().optional(),
      username: f.string().min(3).max(20).regex('^[a-z0-9_]+$', 'lowercase alphanumeric'),
    }),
    tags: f.string().min(2).max(30).array(),
    createdAt: f.datetime(),
  }))
  .build();
```

**String constraints**: `.min(len)`, `.max(len)`, `.email()`, `.url()`, `.date()`, `.datetime()`, `.regex(pattern, description)`

**Number constraints**: `.min(val)`, `.max(val)`

## Assertions

Assertions validate LLM output after generation. If an assertion fails, Ax retries with the error message.

### Post-generation assertions

```typescript
const gen = ax('question:string -> answer:string, confidence:number');

// Return true (pass), false (fail), or a string (fail with message)
gen.addAssert(({ answer }) => {
  if (answer.length < 10) {
    return `Answer too short: ${answer.length} chars (min 10)`;
  }
  return true;
});

// With a fallback message
gen.addAssert(
  ({ confidence }) => confidence > 0.7,
  'Confidence must be above 70%'
);

// Throw for immediate failure (no retry)
gen.addAssert(({ answer }) => {
  if (answer.includes('offensive')) {
    throw new Error('Content moderation failed');
  }
  return true;
});
```

### Streaming assertions

Validate output as it streams in, before generation completes:

```typescript
gen.addStreamingAssert('answer', (content, done) => {
  if (!done) return undefined; // Wait until field is complete
  return content.length >= 10 ? true : 'Answer too brief';
});
```

## Chain of Thought

Use `!` (internal) fields to add reasoning steps that are generated but excluded from the final output. This improves accuracy on complex tasks.

```typescript
// Without chain of thought
const simple = ax('problem:string -> solution:string');

// With chain of thought — reasoning is generated but not returned
const cot = ax('problem:string -> reasoning!:string, solution:string');
```

The LLM is forced to produce `reasoning` first, then `solution`. The `!` means `reasoning` won't appear in the result object — only `solution` is returned.

## Multi-Modal

Image and audio fields work as inputs. The LLM receives the media directly.

```typescript
const describe = ax('photo:image, question?:string -> description:string, objects:string[]');

const result = await describe.forward(llm, {
  photo: { url: 'https://example.com/photo.jpg' },
  question: 'What animals are in this image?',
});
```

## Optimization

Signatures + examples enable automatic prompt tuning. Provide examples of correct input/output pairs, and the optimizer finds better prompts and demonstrations.

```typescript
const gen = ax('question:string -> answer:string');

// Provide examples
gen.setExamples([
  { question: 'What is 2+2?', answer: '4' },
  { question: 'Capital of France?', answer: 'Paris' },
]);
```

For automatic optimization with MiPRO, GEPA, or ACE, see the [Optimization Guide](/optimize/).

## Streaming

All signatures support streaming. Pass `stream: true` to get results as they generate:

```typescript
const gen = ax('question:string -> answer:string');

const result = await gen.forward(
  llm,
  { question: 'Explain quantum computing' },
  { stream: true }
);
```

Streaming works with assertions and validation — Ax validates fields as they complete.

## Next Steps

- [Signatures Guide](https://github.com/ax-llm/ax/blob/main/src/ax/skills/ax-signature.md) — Full field type reference
- [AxGen Guide](https://github.com/ax-llm/ax/blob/main/src/ax/skills/ax-gen.md) — Generation options, retries, hooks
- [AxAgent Guide](https://github.com/ax-llm/ax/blob/main/src/ax/skills/ax-agent.md) — Autonomous agents with ReAct loops
- [Optimization Guide](/optimize/) — MiPRO, GEPA, and ACE optimizers
- [Telemetry](/telemetry/) — OpenTelemetry tracing and metrics
- [Try it live](/playground) — DSPy Notebook playground
