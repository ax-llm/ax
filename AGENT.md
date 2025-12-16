# Ax LLM Framework - Agent Instructions

## Project Overview

Ax is a TypeScript framework for building LLM-powered agents with end-to-end streaming, multi-modal DSPy capabilities, and typed signatures. It provides a standard interface across all top LLMs with features like prompt compilation, native streaming, agent orchestration, RAG, vector databases, and automatic prompt tuning.

## Repository Structure

This is a **multi-repository monorepo** with the following structure:

- `src/ax/` - Main Ax library (`@ax-llm/ax`)
- `src/ai-sdk-provider/` - Vercel AI SDK provider (`@ax-llm/ax-ai-sdk-provider`)
- `src/examples/` - Example implementations (`@ax-llm/ax-examples`)
- `src/docs/` - Documentation site (`@ax-llm/ax-docs`)

## Package Management

**IMPORTANT**: Use workspace-specific package installation commands:

```bash
# Install packages in specific workspaces
npm i <package-name> --workspace=@ax-llm/ax
npm i <package-name> --workspace=@ax-llm/ax-ai-sdk-provider
npm i <package-name> --workspace=@ax-llm/ax-examples
npm i <package-name> --workspace=@ax-llm/ax-docs
```

**DO NOT** run `npm install` in individual sub-directories. Always use workspace commands from the root.

## Current Recommended Patterns (v13.0.24+)

### ✅ **RECOMMENDED: Use Factory Functions and String Functions**

```typescript
import { ai, agent, s, ax, f } from '@ax-llm/ax'

// 1. AI Instance Creation (use factory function)
const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!
})

// 2. Signature Creation (use s function)
const signature = s(`
  userQuestion:string "User input" -> 
  responseText:string "AI response",
  confidenceScore:number "Confidence 0-1"
`)

// 3. Generator Creation (use ax function)
const generator = ax(`
  emailText:string "Email content" -> 
  categoryType:class "urgent, normal, low" "Priority level",
  actionItems:string[] "Required actions"
`)

// 4. Agent Creation (use factory function)
const agentInstance = agent(
  'userInput:string "User question" -> responseText:string "Agent response"',
  {
    name: 'helpfulAgent',
    description: 'An agent that provides helpful responses to user questions',
    definition: 'You are a helpful assistant that provides clear, accurate responses to user questions.',
    ai: llm
  }
)
```

### ❌ **DEPRECATED: Constructors and Template Literals (will be removed v15.0.0)**

```typescript
// ❌ DEPRECATED: Constructor, template literals
const ai = new AxAI({ name: 'openai', apiKey: '...' })
const sig = s`userQuestion:${f.string()} -> responseText:${f.string()}` // template literals
const gen = ax`emailText:${f.string()} -> categoryType:${f.class(['a', 'b'])}` // template literals
```

## Signatures and Validation

### Field Types Reference

| Type | Syntax | Example |
|------|---------|---------|
| **Basic types** | `field:type "description"` | `userInput:string "User question"` |
| **Numbers** | `field:number "description"` | `score:number "Confidence 0-1"` |
| **Booleans** | `field:boolean "description"` | `isValid:boolean "Input validity"` |
| **JSON** | `field:json "description"` | `metadata:json "Extra data"` |
| **Arrays** | `field:type[] "description"` | `tags:string[] "Keywords"` |
| **Optional** | `field?:type "description"` | `context?:string "Optional context"` |
| **Classifications** | `field:class "opt1, opt2" "description"` | `category:class "urgent, normal, low" "Priority"` |
| **Dates** | `field:date "description"` | `dueDate:date "Due date"` |
| **DateTime** | `field:datetime "description"` | `timestamp:datetime "Event time"` |
| **Media types** | `field:image/audio/file/url` | `photo:image "Profile picture"` |
| **Code** | `field:code "description"` | `script:code "Python code"` |

### Pure Fluent API & Validation Constraints

For complex validation, use the pure fluent API:

```typescript
import { f, ax } from '@ax-llm/ax';

const userRegistration = f()
  .input('formData', f.string('Raw form data'))
  .output('user', f.object({
    username: f.string('Username').min(3).max(20),
    email: f.string('Email address').email(),
    age: f.number('User age').min(18).max(120),
    website: f.string('Personal website').url().optional(),
    tags: f.string('Interest tag').min(2).max(30).array()
  }))
  .build();

const generator = ax(userRegistration);
```

**Available Constraints:**
- `.min(n)` / `.max(n)` - String length or number range
- `.email()` - Email format validation (or use `f.email()`)
- `.url()` - URL format validation (or use `f.url()`)
- `.date()` - Date format validation (or use `f.date()`)
- `.datetime()` - DateTime format validation (or use `f.datetime()`)
- `.regex(pattern, description)` - Custom regex pattern with human-readable description
- `.optional()` - Make field optional

**Note:** For email, url, date, and datetime, you can use either the validator syntax (`f.string().email()`) or the dedicated type syntax (`f.email()`). Both work consistently in all contexts!

## AI Providers and Presets

Define model presets for consistent configuration:

```typescript
const gemini = ai({
  name: "google-gemini",
  apiKey: process.env.GOOGLE_APIKEY!,
  config: { model: "simple" },
  models: [
    {
      key: "tiny",
      model: "gemini-2.0-flash-lite",
      description: "Fast + cheap",
      config: { maxTokens: 1024, temperature: 0.3 },
    },
    {
      key: "simple",
      model: "gemini-2.0-flash",
      description: "Balanced general-purpose",
      config: { temperature: 0.6 },
    },
  ],
});

// Use a preset by key
await gemini.chat({
  model: "tiny",
  chatPrompt: [{ role: "user", content: "Summarize this:" }],
});
```

## Testing Guide

### Quick Test Commands

```bash
# Run all tests across all workspaces
npm run test

# Run all unit tests in main workspace
npm run test --workspace=@ax-llm/ax

# Run a specific test file
npx vitest run src/ax/dsp/generate.test.ts

# Run tests with coverage
npx vitest --coverage
```

### Test Categories

1.  **Unit Tests** (`.test.ts`): Test individual functions and modules.
2.  **Type Definition Tests** (`.test-d.ts`): Validate TypeScript type inference.
3.  **Integration Tests**: Use `src/examples/` as integration tests.

### Writing Good Tests

-   **Structure**: Use `describe` and `it` blocks.
-   **Naming**: Be specific (e.g., "should default missing types to string").
-   **Focus**: Test one thing per test case.

## Demo Creation Guidelines

-   **Top-level code**: No function wrappers, direct execution.
-   **No try-catch**: Keep it simple.
-   **Minimal logs**: Only essential output.
-   **Export reusable components**: Generators, signatures, etc.

## Development Commands

```bash
# Build all workspaces
npm run build

# Fix formatting and linting
npm run fix

# Run examples with tsx
npm run tsx ./src/examples/<example-file>.ts

# Development mode for specific workspace
npm run dev --workspace=@ax-llm/ax

# Regenerate index.ts (auto-generated, DO NOT edit manually)
npm run build:index --workspace=@ax-llm/ax
```

> **IMPORTANT**: `src/ax/index.ts` is auto-generated by the `build:index` script. **DO NOT manually edit this file.** If you add new exports, ensure the source files export them correctly and run `npm run build:index --workspace=@ax-llm/ax` to regenerate.

### Running Specific Examples

To run the Anthropic prompt caching example (ensure `ANTHROPIC_API_KEY` is set in `.env`):

```bash
npm run tsx src/examples/test-anthropic-cache.ts
```

## Dependencies & Constraints

-   **Node.js**: >= 20
-   **Runtime**: ES Modules only
-   **Browser Compatibility**: **CRITICAL** - Do not add filesystem calls (`fs`, `path`, `os`) to the main library (`src/ax/`). Use only web-standard APIs.

## Security & Best Practices

-   Never commit API keys.
-   Use environment variables.
-   Validate inputs and outputs.
-   Implement rate limiting.

## Environment Setup

```bash
# Required environment variables (examples)
OPENAI_APIKEY=your_key_here
GOOGLE_APIKEY=your_key_here
ANTHROPIC_APIKEY=your_key_here
```
