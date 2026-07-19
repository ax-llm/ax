---
name: ax-signature
description: This skill helps an LLM generate correct DSPy signature code using @ax-llm/ax. Use when the user asks about signatures, s(), f(), field types, string syntax, fluent builder API, validation constraints, or type-safe inputs/outputs.
version: "23.0.1"
---

# Ax Signature Reference

## Signature Syntax

```
[description] input1:type, input2:type -> output1:type, output2:type
```

## Field Types

| Type | Syntax | TypeScript | Example |
|------|--------|-----------|---------|
| String | `:string` | `string` | `userName:string` |
| Number | `:number` | `number` | `score:number` |
| Boolean | `:boolean` | `boolean` | `isValid:boolean` |
| JSON | `:json` | `any` | `metadata:json` |
| Date | `:date` | `Date` | `birthDate:date` |
| DateTime | `:datetime` | `Date` | `timestamp:datetime` |
| DateRange | `:dateRange` | `{ start: Date; end: Date }` | `travelDates:dateRange` |
| DateTimeRange | `:datetimeRange` | `{ start: Date; end: Date }` | `meetingWindow:datetimeRange` |
| Image | `:image` | `{mimeType, data}` | `photo:image` (input only) |
| Audio | `:audio` | input: `AxAudioInput`; output: `AxChatAudioOutput` | `recording:audio`, `speech:audio` |
| File | `:file` | `{mimeType, data}` | `document:file` (input only) |
| URL | `:url` | `string` | `website:url` |
| Code | `:code` | `string` | `pythonScript:code` |
| Class | `:class "a, b, c"` | `"a" \| "b" \| "c"` | `mood:class "happy, sad"` |

Date, datetime, and range fields are AI-friendly but strict. They accept ISO-style values, trim minor whitespace/casing issues, and parse ranges as `{ "start": "...", "end": "..." }`, `[start, end]`, `start/end`, or natural delimiters like `start to end`; invalid values and reversed ranges should fail validation rather than being silently autocorrected.

## Arrays, Optional, and Internal Fields

```typescript
'tags:string[] -> processedTags:string[]'  // arrays
'query:string, context?:string -> response:string'  // optional with ?
'problem:string -> reasoning!:string, solution:string'  // internal with !
```

## Extended String Grammar (Modifier Bags + Nested Objects)

The string form is constraint-complete: everything the fluent API expresses
(except Standard Schema fields) can be written in the string. A type takes an
optional comma-separated, order-free **modifier bag** in parentheses, and
objects declare structured fields inline.

```typescript
`userAge:number(min 0, max 120), contactEmail:string(format email, cache), codeSnippet:code(python)
 -> userName:string(pattern "^[a-z_]+$" "lowercase name"), tagList:string(item "a short tag")[] "all tags",
    profileList:object{ fullName:string, userAge?:number(min 0) }[] "matched profiles"`
```

| Modifier | Applies to | Effect |
|----------|-----------|--------|
| `min N` / `max N` | `string`, `number` | String length bounds / numeric value bounds |
| `format email\|uri\|date\|date-time` | `string` | Format validation |
| `pattern "regex" ["desc"]` | `string` | Regex validation with optional description |
| `cache` | top-level input | Prefix-cache breakpoint |
| `item "desc"` | arrays | Per-item description: `tags:string(item "a tag")[]` |
| `<language>` | `code` | Language of the snippet: `snippet:code(python)` |

- `object{ field:type, opt?:type }` nests recursively; append `[]` for an array of objects.
- Optional goes on the **name** (`userAge?:number`), never after the type.
- The string API is **strict**: a modifier that does not apply to its type (e.g. `min` on a boolean) is a parse error, where the fluent API silently ignores it.
- Inside `object{ ... }`, the `!` internal marker, media types, `cache`, and `item` are rejected (they only apply at the top level).
- In quoted values, backslashes are doubled — a regex `\d` is written `pattern "\\d+"`.
- `AxSignature.toString()` renders every construct back to this grammar losslessly, so a signature round-trips — this is what lets a whole flow serialize its node contracts into mermaid `%%ax` directives (see the ax-flow skill).

## Signature Gallery

Real-world contracts, one line each — every entry below parses with `s()` as written (`#` lines are captions, not part of the signature):

```text
# Support triage: several class outputs plus a capped reply draft
ticketText:string -> priorityClass:class "p0, p1, p2", sentimentClass:class "angry, neutral, happy", replyDraft:string(max 500)

# Invoice extraction: regex-validated id, bounded totals, structured line items
invoiceText:string -> invoiceNumber:string(pattern "^INV-\\d+$" "INV- then digits"), totalAmount:number(min 0), lineItems:object{ description:string, quantity:number(min 1), unitPrice:number }[]

# Contact enrichment: optional format-validated outputs
bioText:string -> contactEmail?:string(format email), websiteUrl?:string(format uri), birthDate?:string(format date)

# RAG: cached corpus input plus per-item described citations
corpusText:string(cache), userQuestion:string -> answerText:string, citedChunks:string(item "verbatim quote")[]

# Code generation: language-tagged code outputs
taskBrief:string -> pythonScript:code(python), testCases:code(python), riskNotes?:string

# Chain of thought: internal reasoning stripped from the result
problemText:string -> reasoning!:string, solutionText:string

# Resume parsing: nested objects inside nested arrays
resumeText:string -> candidateProfile:object{ fullName:string, yearsExperience:number(min 0), skillList:string[], education:object{ schoolName:string, degreeName?:string }[] }

# Lead scoring: signature-level description, bounded score, class next step
"Score sales leads" leadNotes:string -> fitScore:number(min 0, max 100) "0-100 fit", nextStep:class "call, email, drop"

# Multimodal: top-level image input with an optional question
productPhoto:image, question?:string -> productDescription:string, detectedObjects:string[]

# Meeting audio: audio input, capped summary, per-item action list
meetingAudio:audio -> meetingSummary:string(max 1000), actionItems:string(item "one action item")[]

# Moderation: class verdict plus structured flagged spans
postText:string -> moderationVerdict:class "allow, review, block", flaggedSpans:object{ spanText:string, reasonNote:string }[]

# Translation: optional locale input
sourceText:string, targetLocale?:string -> translatedText:string, glossaryHits:string[]
```

## Four Ways to Create Signatures

### 1. String-Based (Recommended for simple cases)

```typescript
import { ax, s } from '@ax-llm/ax';
const gen = ax('input:string -> output:string');
const sig = s('query:string -> response:string');
```

### 2. Pure Fluent Builder API

```typescript
import { f } from '@ax-llm/ax';
const sig = f()
  .input('userMessage', f.string('User input'))
  .input('contextData', f.string('Additional context').optional())
  .input('tags', f.string('Keywords').array())
  .output('responseText', f.string('AI response'))
  .output('confidenceScore', f.number('Confidence 0-1'))
  .output('debugInfo', f.string('Debug info').internal())
  .build();
```

### 3. Standard Schema (zod / valibot / arktype)

`.input()` and `.output()` accept any [Standard Schema v1](https://standardschema.dev) compatible library — no wrapper, no adapter. Three shapes work everywhere:

```typescript
import { z } from 'zod';
import { f } from '@ax-llm/ax';

// Shape A: per-field schema — name first, then the schema, then optional ax hints
const sig = f()
  .input('contextData', z.string().describe('Background context'), { cache: true })
  .input('userQuestion', z.string().describe('Question to answer'))
  .output('reasoning', z.string().describe('Step-by-step thinking'), { internal: true })
  .output('answer', z.string().describe('Final answer'))
  .build();

// Shape B: whole-object schema — decomposed into fields in declaration order
const sig2 = f()
  .description('Answer questions from retrieved context')
  .input(
    z.object({
      contextData: z.string().describe('Background context'),
      userQuestion: z.string().describe('Question to answer'),
    }),
    { fields: { contextData: { cache: true } } }  // companion options map
  )
  .output(
    z.object({
      reasoning: z.string().describe('Step-by-step thinking'),
      answer: z.string().describe('Final answer'),
    }),
    { fields: { reasoning: { internal: true } } }
  )
  .build();
```

Validation constraints from zod flow into ax's prompt validation:

```typescript
// String constraints: .email(), .url(), .min(), .max(), .regex()
// Number constraints: .min(), .max()
// Arrays: z.array(z.string())
// Enums: z.enum([...])  — NOTE: enum maps to ax class type, output fields only
const sig3 = f()
  .input(z.object({
    emailAddress: z.string().email().describe('Contact email'),
    username: z.string().min(3).max(20).describe('Handle'),
    score: z.number().min(0).max(100).describe('Numeric score'),
  }))
  .output(z.object({
    priority: z.enum(['low', 'medium', 'high']).describe('Priority'),
    summary: z.string().describe('Result'),
  }))
  .build();
```

**Companion options** (`AxFieldOptions`) carry ax-specific hints that schema libraries don't represent:

| Option | Effect |
|--------|--------|
| `{ cache: true }` | Mark input field as a prefix-cache breakpoint |
| `{ internal: true }` | Mark output field as internal scratchpad (stripped from result) |

The same Standard Schema shapes work on `fn()` tools via `.arg()`, `.returns()`, and `.returnsField()` — argument types are inferred from the schema:

```typescript
import { z } from 'zod';
import { fn } from '@ax-llm/ax';

// Whole-object zod on a tool — AI-SDK-style
const lookupProduct = fn('lookupProduct')
  .description('Look up a product by name and return its current details')
  .arg(
    z.object({
      productName: z.string().min(1).describe('Exact product name'),
      includeSpecs: z.boolean().optional(),
    })
  )
  .returns(
    z.object({
      price: z.number(),
      inStock: z.boolean(),
      rating: z.number().min(1).max(5),
    })
  )
  .handler(async ({ productName, includeSpecs }) => ({
    price: 79.99,
    inStock: true,
    rating: 4.3,
  }))
  .build();

// Per-argument form — mix with f.*() args, attach ax hints
const searchDocs = fn('searchDocs')
  .description('Search indexed docs')
  .arg('query', z.string().min(1), { cache: true })
  .arg('limit', z.number().int().positive().optional())
  .returnsField('results', z.array(z.string()))
  .handler(async ({ query }) => [])
  .build();
```

### 4. Hybrid

```typescript
import { s, f } from '@ax-llm/ax';
const sig = s('base:string -> result:string')
  .appendInputField('extra', f.json('Metadata').optional())
  .appendOutputField('score', f.number('Quality score'));
```

## Fluent API Reference

Type creators:
- `f.string(desc)`, `f.number(desc)`, `f.boolean(desc)`, `f.json(desc)`
- `f.image(desc)`, `f.audio(desc)`, `f.file(desc)`, `f.url(desc)`
- `f.email(desc)`, `f.date(desc)`, `f.datetime(desc)`, `f.dateRange(desc)`, `f.datetimeRange(desc)`
- `f.class(['a','b','c'], desc)`, `f.code(desc)`
- `f.object({ field: f.string() }, desc)`

Chainable modifiers (method chaining only, no nesting):
- `.optional()` - make field optional
- `.array()` / `.array('list description')` - make field an array
- `.internal()` - output only, hidden from final output
- `.cache()` - input only, mark for prompt caching

```typescript
// Correct: pure fluent chaining
f.string('description').optional().array()
f.string('context').cache().optional()
f.object({ field: f.string() }, 'item desc').array('list desc')

// Wrong: nested function calls (removed)
f.array(f.string('description'))      // REMOVED
f.optional(f.string('description'))   // REMOVED
f.internal(f.string('description'))   // REMOVED
```

## Validation Constraints

### String Constraints

```typescript
f.string('username').min(3).max(20)
f.string('email').email()
f.string('website').url()
f.string('birthDate').date()
f.string('timestamp').datetime()
f.string('pattern').regex('^[A-Z0-9]')
```

### Number Constraints

```typescript
f.number('age').min(18).max(120)
f.number('score').min(0).max(100)
```

### Complete Validation Example

```typescript
const sig = f()
  .input('formData', f.string('Raw form data'))
  .output('user', f.object({
    username: f.string('Username').min(3).max(20),
    email: f.string('Email').email(),
    age: f.number('Age').min(18).max(120),
    bio: f.string('Bio').max(500).optional(),
    website: f.string('Website').url().optional(),
    tags: f.string('Tag').min(2).max(30).array()
  }, 'User profile'))
  .build();
```

## Cached Input Fields

```typescript
const sig = f()
  .input('staticContext', f.string('Context').cache())
  .input('userQuery', f.string('Dynamic query'))
  .output('answer', f.string('Response'))
  .build();
```

## Field Naming Rules

Good: `userQuestion`, `customerEmail`, `analysisResult`, `confidenceScore`
Bad: `text`, `data`, `input`, `output`, `a`, `x`, `val` (too generic), `1field` (starts with number)

## Media Type Restrictions

- Image and file fields are top-level input fields only.
- Audio fields can be top-level inputs or single top-level outputs.
- Audio output fields are scripted speech artifacts: the model returns plain text, then Ax synthesizes `AxChatAudioOutput`.
- Media fields cannot be nested in objects.
- Media arrays are supported for inputs only; output `audio[]` is not supported.

## Common Patterns

```typescript
// Chain of Thought
'problem:string -> reasoning!:string, solution:string'

// Classification
'email:string -> priority:class "urgent, normal, low"'

// Multi-modal input
'imageData:image, question?:string -> description:string, objects:string[]'

// Scripted speech output
'question:string -> speech:audio, summary:string'

// Data Extraction
'invoiceText:string -> invoiceNumber:string, totalAmount:number, lineItems:json[]'

// Constrained string form (no fluent builder needed)
'reviewText:string(max 2000) -> rating:number(min 1, max 5), themes:string(item "a theme")[]'

// Nested object output in the string form
'profileText:string -> profile:object{ fullName:string, age?:number(min 0) }'

// With description
'"Answer TypeScript questions" question:string -> answer:string, confidence:number'
```

## Critical Rules

- The string form is constraint-complete: reach for modifier bags (`string(max 500)`, `number(min 0, max 10)`, `string(format email)`) and inline `object{ ... }` before switching to fluent/zod just for constraints. Reserve fluent/Standard Schema for zod/valibot-backed fields.
- The string API is strict — a modifier that does not apply to its type is a parse error (the fluent API silently ignores it).
- Use `f()` fluent builder, NOT nested `f.array(f.string())` -- those are removed.
- Field names must be descriptive (not generic like `text`, `data`, `input`).
- Image/file media types are input-only, top-level only; audio may also be a single top-level output.
- `.internal()` / `{ internal: true }` is output-only (for chain-of-thought reasoning).
- `.cache()` / `{ cache: true }` is input-only (for prompt caching).
- Validation errors trigger auto-retry with correction feedback.
- `f.email()`, `f.url()`, `f.date()`, `f.datetime()` are shorthand for `f.string().email()` etc.; `f.dateRange()` and `f.datetimeRange()` return `{ start: Date; end: Date }`.
- `z.enum()` maps to ax's `class` type — only valid on **output** fields.
- For multimodal inputs (images, audio, files) and scripted audio outputs, use `f.image()` / `f.audio()` / `f.file()` — zod has no equivalent.

## Examples

Fetch these for full working code:

- [Standard Schema (zod)](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/standard-schema.ts) — zod with f() and fn(), all three shapes
- [Fluent Signature](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/fluent-signature-example.ts) — native fluent f() API
- [Structured Output](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/structured_output.ts) — structured output with validation
- [Debug Schema](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/debug_schema.ts) — JSON schema validation
