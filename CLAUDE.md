---
description: 
globs: 
alwaysApply: true
---
# Ax LLM Framework - Cursor Rules

## Project Overview
Ax is a TypeScript framework for building LLM-powered agents with end-to-end streaming, multi-modal DSPy capabilities, and typed signatures. It provides a standard interface across all top LLMs with features like prompt compilation, native streaming, agent orchestration, RAG, vector databases, and automatic prompt tuning.

## Repository Structure
This is a **multi-repository monorepo** with the following structure:
- `src/ax/` - Main Ax library (`@ax-llm/ax`)
- `src/ai-sdk-provider/` - Vercel AI SDK provider (`@ax-llm/ax-ai-sdk-provider`)
- `src/examples/` - Example implementations (`@ax-llm/ax-examples`)
- `src/docs/` - Documentation site (`@ax-llm/ax-docs`)

Each sub-repository under `src/` has its own `package.json` and can be developed independently.

## Package Management
**IMPORTANT**: Use workspace-specific package installation commands:

```bash
# Install packages in specific workspaces
npm i <package-name> --workspace=@ax-llm/ax
npm i <package-name> --workspace=@ax-llm/ax-ai-sdk-provider
npm i <package-name> --workspace=@ax-llm/ax-examples
npm i <package-name> --workspace=@ax-llm/ax-docs

# Examples:
npm i typescript --workspace=@ax-llm/ax
npm i react --workspace=@ax-llm/ax-docs
npm i lodash --workspace=@ax-llm/ax-examples
```

**DO NOT** run `npm install` in individual sub-directories. Always use workspace commands from the root.

## Testing
- **Test Framework**: Vitest (configured in root)
- **Run Tests**: `npx vitest` for example `npx vitest run src/ax/dsp/generate.test.ts`
- **Run Tests for Specific Workspace**: `npm run test --workspace=@ax-llm/ax`
- **Watch Mode**: `npx vitest --watch`
- **Coverage**: `npx vitest --coverage`

## Development Commands
```bash
# Build all workspaces
npm run build

# Run tests across all workspaces
npm run test

# Fix formatting and linting
npm run fix

# Run examples with tsx
npm run tsx ./src/examples/<example-file>.ts

# Development mode for specific workspace
npm run dev --workspace=@ax-llm/ax
```

## Demo Creation Guidelines
**KEEP DEMOS SIMPLE AND DIRECT** - No unnecessary abstractions or complexity:

### Structure
- **Top-level code**: Put all code at the top level, no function wrappers
- **Direct execution**: Code should run immediately when file is executed
- **No try-catch blocks**: It's just a demo, don't add error handling clutter
- **No IIFE wrappers**: Top-level await works fine with modern Node.js/tsx
- **Minimal console logs**: Only essential output, avoid verbose logging
- **No fallback logic**: Keep examples clean and focused on the main functionality
- **Public vs Private functions**: Only functions or classes exported publicly outside the library should be prefixed with Ax or ax not internal functions.

### Code Style
- **Export reusable components**: Export generators, signatures, or functions that other examples might use
- **Save minimal data**: Only save essential data (like demos), not complex config objects
- **Import and reuse**: Import exported components in other examples rather than recreating them
- **Clean separation**: Optimize once, save demos, use anywhere

### Example Creation Guidelines

- Do not fill the examples with console.log messages just use one of two
- Do not use try .. catch in examples
- Do not use top level functions
- Keep it simple but make the example interesting

```typescript
// Export reusable generator
export const myGen = ax`input:${f.string('User input')} -> output:${f.string('AI response')}`

// Top-level execution - no function wrappers
console.log('=== Demo ===')

const ai = new AxAI({ name: 'openai', apiKey: process.env.OPENAI_APIKEY! })
const result = await myGen.forward(ai, { input: 'test' })

// Save only essential data
await fs.writeFile('demos.json', JSON.stringify(demos, null, 2))
```

### Key Principles
- **It just works**: Don't overthink it, modern Node.js handles top-level await fine
- **No abstractions**: Avoid function wrappers, IIFEs, or unnecessary error handling
- **Focus on functionality**: Show the core feature, not error handling patterns
- **Reusable components**: Export what others might want to import and use
- **Minimal persistence**: Save only what's needed, not metadata or complex configs
- **Clean and direct**: No try-catch blocks, minimal logging, no fallback complexity

## Code Standards & Architecture

### TypeScript Configuration
- Uses `@total-typescript/tsconfig` as base
- ES Modules (`"type": "module"`)
- NodeNext module resolution
- Path mapping: `@ax-llm/*` → `src/*`
- React JSX support

### Key Architectural Patterns

#### 1. Prompt Signatures & Template Literals
Ax uses a unique prompt signature system with **modern template literal support**:

**PREFERRED: Template Literals with Field Builders**
```typescript
import { ax, s, f } from '@ax-llm/ax'

// Using the `s` template literal for signatures
const signature = s`
  userQuestion:${f.string('User input')} -> 
  responseText:${f.string('AI response')},
  confidenceScore:${f.number('Confidence 0-1')}
`

// Using the `ax` template literal for AxGen instances
const generator = ax`
  emailText:${f.string('Email content')} -> 
  categoryType:${f.class(['urgent', 'normal', 'low'], 'Priority level')},
  actionItems:${f.array(f.string('Required actions'))}
`
```

**Legacy: String-based signatures (discouraged for new code)**
```typescript
// Format: "task description" inputField:type "field description" -> outputField:type
const signature = `userQuestion -> responseText:string "detailed response"`
const signature = `emailText -> categoryType:class "urgent, normal, low", actionItems:string[]`
```

**Field Types & Builders**:
- **Basic types**: `f.string()`, `f.number()`, `f.boolean()`, `f.date()`, `f.datetime()`, `f.json()`
- **Media types**: `f.image()`, `f.audio()`
- **Classifications**: `f.class(['option1', 'option2'], 'description')`
- **Code blocks**: `f.code('python', 'description')`
- **Arrays**: `f.array(f.string())`, `f.array(f.number())`, etc.
- **Modifiers**: `f.optional(f.string())`, `f.internal(f.string())`, chaining: `f.optional(f.array(f.string()))`
- **Field names should be descriptive**: `emailText` not `text`, `userQuestion` not `question`

**CRITICAL - Field Naming Requirements**:
- **NEVER use generic field names** like `text`, `result`, `value`, `item`, `data`, `input`, `output`
- **ALWAYS use descriptive field names** that indicate the content's purpose:
  - ✅ Good: `documentText`, `userQuestion`, `responseText`, `summaryText`, `emailContent`
  - ✅ Good: `processedResult`, `analysisOutput`, `categoryType`, `confidenceScore`
  - ✅ Good: `inputData`, `outputResult`, `dataItem`, `iterationCount`
  - ❌ Bad: `text`, `result`, `value`, `item`, `data`, `input`, `output`
- **Signature validation will reject generic names** - this is enforced at runtime
- **Use context-specific names** that make the field's role clear in the signature

**Template Literal Advantages**:
- Type-safe field creation with IntelliSense
- Cleaner, more readable syntax
- Supports field interpolation and complex structures
- Better error messages and validation
- Consistent with modern JavaScript/TypeScript patterns

#### 2. Core Components
- **AxAI**: Main AI interface supporting 15+ LLM providers
- **AxChainOfThought**: Chain-of-thought reasoning
- **AxAgent**: Agent framework with inter-agent communication
- **AxDB**: Vector database abstraction (Memory, Weaviate, Pinecone, Cloudflare)
- **AxDBManager**: Smart chunking, embedding, and querying

#### 3. Streaming & Multi-modal
- Native end-to-end streaming
- Multi-modal support (text, images, audio)
- Thinking models support with token budget control
- Real-time validation during streaming

### Code Conventions

#### Naming Conventions
**CRITICAL**: All publicly exported (to the users of this library)  functions and utilities must be prefixed with `ax` or classes `Ax` do not do this with internal functions

**Classes and Types**: Follow existing patterns:
- Classes: `AxClassName` (e.g., `AxAI`, `AxChainOfThought`)
- Types/Interfaces: `AxTypeName` (e.g., `AxLoggerFunction`, `AxOptimizerArgs`)
- Functions/Utilities: `axFunctionName` (e.g., `axCreateOptimizerLogger`, `axDefaultOptimizerLogger`)

#### Import/Export Patterns
```typescript
// Prefer named exports
export { AxAI, AxChainOfThought, AxAgent }

// Use barrel exports in sub-module index.ts files (not the main index.ts which is auto-generated)
export * from './ai/index.js'
export * from './prompts/index.js'
```

#### Async Patterns
- All LLM operations are async and support streaming
- Use async generators for streaming responses
- Implement proper cleanup for streaming connections

## File Organization

### Main Library (`src/ax/`)
- `ai/` - LLM provider implementations
- `prompts/` - Prompt signature and DSPy logic
- `agents/` - Agent framework
- `db/` - Vector database implementations
- `trace/` - OpenTelemetry integration
- `funcs/` - Function calling utilities
- `mcp/` - Model Context Protocol support
- `flow/` - AxFlow ai workflow orchastration engine
- `dsp` - The AxGen implementation which sits at the core of this library

### Provider Package (`src/ai-sdk-provider/`)
- Integration with Vercel AI SDK
- Provider utilities and transformations

### Examples (`src/examples/`)
- Comprehensive examples for all features
- Each example should be runnable with `npm run tsx`
- Include proper environment variable setup
- **ALWAYS use template literals** (`ax` and `s`) in examples, not string-based signatures
- Use descriptive field names following the `emailText` not `text` pattern

## Dependencies & Constraints
- **Node.js**: >= 20
- **Runtime**: ES Modules only
- **Core Dependencies**: Minimal, zero-dependencies philosophy
- **Peer Dependencies**: Handle LLM SDKs as peer deps where possible
- **Browser Compatibility**: **CRITICAL** - Do not add filesystem calls (`fs`, `path`, `os`) or other Node.js-specific APIs to the main library (`src/ax/`). The library must run in browser environments. Use only web-standard APIs and platform-agnostic code. Node.js-specific functionality should be in examples or separate utility packages.

## Testing Guidelines
- Write tests in `.test.ts` files
- Use Vitest for unit testing
- Test streaming scenarios
- Mock LLM providers for deterministic tests
- Include type-level tests in `.test-d.ts` files

## Documentation
- TypeDoc for API documentation
- Markdown documentation in `src/docs/`
- Examples serve as living documentation
- Include prompt signature examples in code comments

## Security & Best Practices
- Never commit API keys
- Use environment variables for configuration
- Validate all inputs, especially in streaming contexts
- Implement proper rate limiting and error recovery
- Follow principle of least privilege for LLM permissions

## Performance Considerations
- Optimize for streaming performance
- Minimize token usage through smart prompting
- Cache embeddings and model responses where appropriate
- Use connection pooling for database operations
- Profile memory usage in long-running streams

## OpenTelemetry Integration
- Built-in `gen_ai` semantic conventions support
- Trace all LLM operations
- Include custom spans for agent interactions
- Export traces in production environments

## Environment Setup
```bash
# Required environment variables (examples)
OPENAI_APIKEY=your_key_here
GOOGLE_APIKEY=your_key_here
ANTHROPIC_APIKEY=your_key_here

# Optional for specific features
WEAVIATE_URL=http://localhost:8080
PINECONE_API_KEY=your_key_here
```

## Common Patterns
1. **Creating AI Instance**: Always start with `new AxAI({ name: 'provider', apiKey: '...' })`
2. **Template Literals**: **PREFER** using `ax` and `s` template literals over string-based signatures
3. **Field Creation**: Use `f.string()`, `f.class()`, etc. instead of raw type strings
4. **Signature Design**: Keep signatures simple and descriptive with meaningful field names
5. **Agent Composition**: Agents can call other agents for complex workflows
6. **Streaming Handling**: Always handle both success and error states in streams
7. **Type Safety**: Leverage TypeScript's type system for prompt validation

## Build & Release
- Uses `tsup` for building
- Automated versioning with `standard-version`
- Multi-workspace publishing with `release-it`
- GitHub Actions for CI/CD
- **Auto-generated Files**: `index.ts` in the main library is auto-generated by running `npm run build:index --workspace=@ax-llm/ax`

## Template Literal Best Practices
- **Always prefer** `ax` template literals over `new AxGen()` for creating generators
- **Always prefer** `s` template literals over `new AxSignature()` for creating signatures
- **Import pattern**: `import { ax, s, f } from '@ax-llm/ax'`
- **Field naming**: Use descriptive names like `userQuestion`, `emailText`, `responseText`
- **Type safety**: Leverage `f.string()`, `f.class()`, etc. for better IntelliSense and validation
- **Complex fields**: Chain modifiers like `f.optional(f.array(f.string('descriptions')))`

## Documentation Guidelines
- When implementing big new features, **ask to update the README.md** with examples and documentation
- Include the new feature in the feature list and provide clear usage examples
- Update TypeDoc comments for new APIs
- Add corresponding examples in `src/examples/` for new functionality
- **When creating new examples, always add them to the examples table in README.md** with a clear description
- **ALL examples must use template literals** (`ax`, `s`, `f`) instead of string-based signatures

Remember: This is a production-ready library used by startups in production. Maintain high code quality, comprehensive testing, and backward compatibility. 