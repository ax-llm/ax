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

# 🧪 TESTING GUIDE

## Test Framework & Overview
- **Primary Framework**: Vitest (configured in root)
- **Type Testing**: TypeScript definition files (`.test-d.ts`)
- **Lint/Format**: Biome for code quality
- **Coverage**: C8 integration with Vitest

## 🚀 Quick Test Commands

### Running Tests Globally
```bash
# Run all tests across all workspaces
npm run test

# Run all unit tests in main workspace
npm run test --workspace=@ax-llm/ax

# Build all workspaces (includes type checking)
npm run build
```

### Running Specific Tests
```bash
# Run a specific test file
npx vitest run src/ax/dsp/generate.test.ts

# Run tests matching a pattern
npx vitest run src/ax/dsp/

# Run tests in watch mode (re-runs on file changes)
npx vitest --watch

# Run tests with coverage report
npx vitest --coverage
```

## 📋 Main Workspace Test Commands (`@ax-llm/ax`)

All commands should be run from the repository root:

```bash
# Full test suite for main library
npm run test --workspace=@ax-llm/ax

# Individual test types
npm run test:unit --workspace=@ax-llm/ax          # Unit tests only
npm run test:type-check --workspace=@ax-llm/ax    # TypeScript validation
npm run test:lint --workspace=@ax-llm/ax          # Biome linting
npm run test:format --workspace=@ax-llm/ax        # Biome formatting

# Fix issues automatically
npm run fix --workspace=@ax-llm/ax                # Fix lint + format
npm run fix:lint --workspace=@ax-llm/ax           # Fix linting only
npm run fix:format --workspace=@ax-llm/ax         # Fix formatting only
```

## 🎯 Test Categories

### 1. Unit Tests (`.test.ts` files)
- **Location**: Throughout `src/ax/` directory
- **Purpose**: Test individual functions, classes, and modules
- **Key Areas**:
  - Signature parsing and validation (`dsp/sig.test.ts`, `dsp/parser.test.ts`)
  - Template literal functionality (`dsp/template.test.ts`)
  - AI service integrations (`ai/*.test.ts`)
  - Flow orchestration (`flow/*.test.ts`)
  - Memory and database operations (`mem/*.test.ts`)

### 2. Type Definition Tests (`.test-d.ts` files)
- **Location**: `src/ax/index.test-d.ts`
- **Purpose**: Validate TypeScript type inference and type safety
- **Testing**: Multi-modal types, signature parsing, optional fields
- **Note**: These test compile-time type behavior, not runtime

### 3. Integration Tests
- **Examples**: `src/examples/` directory serves as integration tests
- **Usage**: `npm run tsx ./src/examples/<example-file>.ts`
- **Purpose**: Test real-world usage patterns and end-to-end functionality

## 🔍 Key Test Files to Know

### Core Framework Tests
```bash
# Signature system (most important for type inference)
npx vitest run src/ax/dsp/sig.test.ts
npx vitest run src/ax/dsp/template.test.ts
npx vitest run src/ax/dsp/parser.test.ts

# AI services and providers  
npx vitest run src/ax/ai/base.test.ts
npx vitest run src/ax/ai/router.test.ts

# Flow orchestration
npx vitest run src/ax/flow/flow.test.ts
npx vitest run src/ax/flow/executionPlanner.test.ts
```

### Performance & Streaming Tests
```bash
# Streaming and generation
npx vitest run src/ax/dsp/generate.test.ts
npx vitest run src/ax/dsp/streaming-optional.test.ts

# Memory and database performance
npx vitest run src/ax/mem/memory.test.ts
```

## 🐛 Test-Driven Development Workflow

### When Adding New Features
1. **Write tests first** in appropriate `.test.ts` file
2. **Add type tests** in `index.test-d.ts` for public APIs
3. **Run specific tests**: `npx vitest run src/ax/path/to/your.test.ts`
4. **Implement feature** until tests pass
5. **Run full test suite**: `npm run test --workspace=@ax-llm/ax`

### When Fixing Bugs
1. **Create reproduction test** that fails
2. **Fix the bug** until test passes
3. **Run related tests**: `npx vitest run src/ax/module/`
4. **Verify no regressions**: Full test suite

### Before Committing
```bash
# Essential pre-commit checks
npm run test:type-check --workspace=@ax-llm/ax  # TypeScript validation
npm run test:unit --workspace=@ax-llm/ax        # All unit tests
npm run fix --workspace=@ax-llm/ax              # Auto-fix lint/format issues
```

## 📊 Test Coverage & Quality

### Coverage Reports
```bash
# Generate coverage report
npx vitest --coverage

# View detailed coverage in browser
npx vitest --coverage --reporter=html
open coverage/index.html
```

### Quality Checks
- **Minimum Coverage**: Aim for >80% coverage on new code
- **Critical Paths**: Signature parsing, AI communication, streaming must be 100%
- **Type Safety**: All public APIs must have type tests
- **Performance**: Include performance regression tests for core operations

## ⚡ Performance Testing

### Benchmarking
```bash
# Run performance-specific tests
npx vitest run src/ax/dsp/generate.metrics.test.ts

# Profile memory usage
npx vitest run --reporter=verbose src/ax/mem/
```

### Load Testing
- Use examples in `src/examples/` for load testing
- Test with multiple concurrent requests
- Monitor token usage and response times

## 🚨 Common Test Issues & Solutions

### Test Failures
```bash
# If tests fail, check these first:
npm run test:type-check --workspace=@ax-llm/ax  # TypeScript errors?
npm run test:lint --workspace=@ax-llm/ax        # Linting issues?

# Clean and rebuild if needed
npm run clean --workspace=@ax-llm/ax
npm run build --workspace=@ax-llm/ax
```

### Environment Issues
- Ensure you're in the repo root when running commands
- Check Node.js version >= 20
- Verify workspace structure with `npm run --workspace=@ax-llm/ax`

## 📝 Writing Good Tests

### Test Structure
```typescript
// Good test example
describe('AxSignature type inference', () => {
  it('should default missing types to string', () => {
    const sig = AxSignature.create('question, image:image -> answer');
    // Test both runtime behavior and type inference
    expect(sig.getInputFields()[0].type).toEqual({ name: 'string', isArray: false });
  });
});
```

### Test Naming
- Be specific: "should default missing types to string" not "should work"
- Include context: "AxSignature type inference" not just "type inference"
- Test one thing: Break complex scenarios into multiple tests

Remember: **Testing is critical** - this library is used in production by startups. Every feature must be thoroughly tested before merging.

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

## 🔧 Signatures and AxGen Deep Dive

### Understanding Signatures
Signatures define the input/output structure for LLM interactions. They specify:
- **Input fields**: What data the LLM receives
- **Output fields**: What structured data the LLM should return
- **Field types**: String, number, array, class (enum), etc.
- **Field descriptions**: Help the LLM understand context

### Template Literal Syntax

#### The `s` Template Literal (Signatures)
```typescript
import { s, f } from '@ax-llm/ax'

// Basic signature structure
const signature = s`inputField:${f.type()} -> outputField:${f.type()}`

// Multiple inputs and outputs
const complexSig = s`
  userMessage:${f.string('User input')},
  contextData:${f.json('Background info')} -> 
  responseText:${f.string('AI response')},
  sentiment:${f.class(['positive', 'negative', 'neutral'])},
  confidence:${f.number('0-1 confidence score')}
`
```

#### The `ax` Template Literal (AxGen Generators)
```typescript
import { ax, f } from '@ax-llm/ax'

// Creates a ready-to-use generator
const emailClassifier = ax`
  emailText:${f.string('Raw email content')} -> 
  category:${f.class(['spam', 'personal', 'work'], 'Email category')},
  priority:${f.class(['high', 'medium', 'low'], 'Priority level')},
  extractedTasks:${f.array(f.string('Action items from email'))}
`

// Use the generator
const ai = new AxAI({ name: 'openai', apiKey: process.env.OPENAI_APIKEY! })
const result = await emailClassifier.forward(ai, { 
  emailText: 'Meeting tomorrow at 3pm about Q4 budget review' 
})
```

### Field Types & Builders
- **Basic types**: `f.string()`, `f.number()`, `f.boolean()`, `f.date()`, `f.datetime()`, `f.json()`
- **Media types**: `f.image()`, `f.audio()`, `f.file()`, `f.url()`
- **Classifications**: `f.class(['option1', 'option2'], 'description')`
- **Code blocks**: `f.code('python', 'description')`
- **Arrays**: `f.array(f.string())`, `f.array(f.number())`, etc.
- **Modifiers**: `f.optional(f.string())`, `f.internal(f.string())`, chaining: `f.optional(f.array(f.string()))`

### Advanced Field Usage
```typescript
// Optional fields
const optionalSig = s`
  userInput:${f.string()} -> 
  response:${f.string()},
  metadata:${f.optional(f.json('Optional extra data'))}
`

// Array fields
const listProcessor = ax`
  itemList:${f.array(f.string('List items'))} -> 
  processedItems:${f.array(f.string('Processed items'))},
  summary:${f.string('Overall summary')}
`

// Complex nested structures
const structuredAnalysis = ax`
  documentText:${f.string('Document to analyze')} -> 
  topics:${f.array(f.string('Main topics'))},
  sentiment:${f.class(['positive', 'negative', 'neutral'])},
  keyPoints:${f.array(f.string('Important points'))},
  actionItems:${f.optional(f.array(f.string('Required actions')))}
`
```

### Field Naming Requirements
**CRITICAL - Field Naming Requirements**:
- **NEVER use generic field names** like `text`, `result`, `value`, `item`, `data`, `input`, `output`
- **ALWAYS use descriptive field names** that indicate the content's purpose:
  - ✅ Good: `documentText`, `userQuestion`, `responseText`, `summaryText`, `emailContent`
  - ✅ Good: `processedResult`, `analysisOutput`, `categoryType`, `confidenceScore`
  - ✅ Good: `inputData`, `outputResult`, `dataItem`, `iterationCount`
  - ❌ Bad: `text`, `result`, `value`, `item`, `data`, `input`, `output`
- **Signature validation will reject generic names** - this is enforced at runtime
- **Use context-specific names** that make the field's role clear in the signature

### Working with AxGen Instances

#### Creating and Using AxGen
```typescript
import { ax, f, AxAI } from '@ax-llm/ax'

// 1. Create generator with ax template literal
const taskExtractor = ax`
  meetingNotes:${f.string('Raw meeting notes')} -> 
  actionItems:${f.array(f.string('Tasks to complete'))},
  decisions:${f.array(f.string('Decisions made'))},
  nextMeetingDate:${f.optional(f.date('Next meeting if mentioned'))}
`

// 2. Set up AI provider
const ai = new AxAI({ 
  name: 'openai', 
  apiKey: process.env.OPENAI_APIKEY!,
  config: { model: 'gpt-4' }
})

// 3. Execute the generator
const result = await taskExtractor.forward(ai, {
  meetingNotes: 'Discussed Q4 budget. John will review numbers by Friday. Next meeting Dec 15th.'
})

// 4. Access typed results
console.log(result.actionItems) // ['John will review Q4 budget numbers by Friday']
console.log(result.decisions)   // ['Discussed Q4 budget planning']
console.log(result.nextMeetingDate) // '2024-12-15'
```

#### Streaming with AxGen
```typescript
const streamingGen = ax`
  storyPrompt:${f.string('Story premise')} -> 
  storyText:${f.string('Generated story')},
  genre:${f.class(['fantasy', 'sci-fi', 'mystery'], 'Story genre')}
`

// Stream the response
for await (const chunk of streamingGen.stream(ai, { 
  storyPrompt: 'A robot discovers emotions' 
})) {
  if (chunk.storyText) {
    process.stdout.write(chunk.storyText)
  }
}
```

### Signature-Only Usage (Advanced)
```typescript
import { s, f, AxGen, AxAI } from '@ax-llm/ax'

// Create signature separately
const analysisSignature = s`
  documentText:${f.string('Document to analyze')} -> 
  mainThemes:${f.array(f.string('Key themes'))},
  readingLevel:${f.class(['elementary', 'middle', 'high', 'college'], 'Reading difficulty')},
  wordCount:${f.number('Approximate word count')}
`

// Use with AxGen constructor
const analyzer = new AxGen(analysisSignature, 'Analyze the given document for themes and readability.')

// Alternative: Convert signature to generator
const generator = analysisSignature.toAxGen('Document analysis task')
```

### Error Handling and Validation
```typescript
try {
  const result = await generator.forward(ai, { documentText: 'Sample text' })
  
  // Results are automatically validated against the signature
  // Type errors will be caught at compile time with TypeScript
  console.log(result.mainThemes) // Type-safe access
  
} catch (error) {
  // Handle validation errors, API errors, etc.
  console.error('Generation failed:', error)
}
```

### Integration Patterns
```typescript
// Chaining generators
const summarizer = ax`
  longText:${f.string('Text to summarize')} -> 
  summary:${f.string('Brief summary')}
`

const classifier = ax`
  summaryText:${f.string('Summary text')} -> 
  category:${f.class(['news', 'opinion', 'tutorial'], 'Content type')}
`

// Chain execution
const summary = await summarizer.forward(ai, { longText: document })
const classification = await classifier.forward(ai, { summaryText: summary.summary })
```

**Template Literal Advantages**:
- Type-safe field creation with IntelliSense
- Cleaner, more readable syntax
- Supports field interpolation and complex structures
- Better error messages and validation
- Consistent with modern JavaScript/TypeScript patterns
- Runtime validation of field names and types
- Automatic TypeScript inference for result types

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
- When implementing big new features, **ask to update the top-level README.md** with examples and documentation
- Include the new feature in the feature list and provide clear usage examples
- Update TypeDoc comments for new APIs
- Add corresponding examples in `src/examples/` for new functionality
- **When creating new examples, always add them to the examples table in the top-level README.md** with a clear description
- **ALL examples must use template literals** (`ax`, `s`, `f`) instead of string-based signatures
- **IMPORTANT**: Only edit the top-level `README.md` file. Never edit files under `src/docs/src/content/` as they are auto-generated and will be overwritten

Remember: This is a production-ready library used by startups in production. Maintain high code quality, comprehensive testing, and backward compatibility. 