---
name: ax-signature
description: This skill helps an LLM generate correct DSPy signature code using @ax-llm/ax. Use when the user asks about signatures, s(), f(), field types, string syntax, fluent builder API, validation constraints, or type-safe inputs/outputs.
version: "__VERSION__"
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
| Image | `:image` | `{mimeType, data}` | `photo:image` (input only) |
| Audio | `:audio` | `{format?, data}` | `recording:audio` (input only) |
| File | `:file` | `{mimeType, data}` | `document:file` (input only) |
| URL | `:url` | `string` | `website:url` |
| Code | `:code` | `string` | `pythonScript:code` |
| Class | `:class "a, b, c"` | `"a" \| "b" \| "c"` | `mood:class "happy, sad"` |

## Arrays, Optional, and Internal Fields

```typescript
'tags:string[] -> processedTags:string[]'  // arrays
'query:string, context?:string -> response:string'  // optional with ?
'problem:string -> reasoning!:string, solution:string'  // internal with !
```

## Three Ways to Create Signatures

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

### 3. Hybrid

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
- `f.email(desc)`, `f.date(desc)`, `f.datetime(desc)`
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

- Media types (image, audio, file) are **top-level input fields only**
- Cannot be nested in objects
- Cannot be output fields

## Common Patterns

```typescript
// Chain of Thought
'problem:string -> reasoning!:string, solution:string'

// Classification
'email:string -> priority:class "urgent, normal, low"'

// Multi-modal
'imageData:image, question?:string -> description:string, objects:string[]'

// Data Extraction
'invoiceText:string -> invoiceNumber:string, totalAmount:number, lineItems:json[]'

// With description
'"Answer TypeScript questions" question:string -> answer:string, confidence:number'
```

## Critical Rules

- Use `f()` fluent builder, NOT nested `f.array(f.string())` -- those are removed.
- Field names must be descriptive (not generic like `text`, `data`, `input`).
- Media types are input-only, top-level only.
- `.internal()` is output-only (for chain-of-thought reasoning).
- `.cache()` is input-only (for prompt caching).
- Validation errors trigger auto-retry with correction feedback.
- `f.email()`, `f.url()`, `f.date()`, `f.datetime()` are shorthand for `f.string().email()` etc.

## Examples

Fetch these for full working code:

- [Fluent Signature](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/fluent-signature-example.ts) — fluent f() API
- [Structured Output](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/structured_output.ts) — structured output with validation
- [Debug Schema](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/debug_schema.ts) — JSON schema validation
