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
export const myGen = ax(`userInput:string "User input" -> aiResponse:string "AI response"`)

// Top-level execution - no function wrappers
console.log('=== Demo ===')

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_APIKEY! })
const result = await myGen.forward(llm, { userInput: 'test' })

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

#### 1. Prompt Signatures & String Functions
Ax uses a unique prompt signature system with **string-based function support**:

**CURRENT RECOMMENDED PATTERNS**
```typescript
import { ai, agent, AxAgent, s, ax, f } from '@ax-llm/ax'

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

// 4a. Agent Creation (use factory function)
const agentInstance = agent(
  'userInput:string "User question" -> responseText:string "Agent response"',
  {
    name: 'helpfulAgent',
    description: 'An agent that provides helpful responses to user questions',
    definition: 'You are a helpful assistant that provides clear, accurate responses to user questions.',
    ai: llm
  }
)

// 4b. Agent Creation (use AxAgent.create static method)
const agentInstance2 = AxAgent.create(
  'userInput:string "User question" -> responseText:string "Agent response"',
  {
    name: 'helpfulAgent',
    description: 'An agent that provides helpful responses to user questions', 
    definition: 'You are a helpful assistant that provides clear, accurate responses to user questions.',
    ai: llm
  }
)

// 5. Field helpers can still be used for dynamic field creation
const dynamicSig = s('userInput:string -> responseText:string')
  .appendInputField('metadata', f.optional(f.json('Extra data')))
  .appendOutputField('confidence', f.number('Confidence score'))
```

**DEPRECATED PATTERNS (will be removed in v15.0.0)**
```typescript
// ❌ DEPRECATED: Constructors, template literals
const ai = new AxAI({ name: 'openai', apiKey: '...' })
const sig = s`userQuestion:${f.string()} -> responseText:${f.string()}` // template literals
const gen = ax`emailText:${f.string()} -> categoryType:${f.class(['a', 'b'])}` // template literals
```

## 🔧 Signatures and AxGen Deep Dive

### Understanding Signatures
Signatures define the input/output structure for LLM interactions. They specify:
- **Input fields**: What data the LLM receives
- **Output fields**: What structured data the LLM should return
- **Field types**: String, number, array, class (enum), etc.
- **Field descriptions**: Help the LLM understand context

### String-Based Function Syntax

#### Current Recommended Approach

```typescript
import { s, ax, f } from '@ax-llm/ax'

// Basic signature structure
const signature = s('inputField:string -> outputField:string')

// Multiple inputs and outputs with descriptions
const complexSig = s(`
  userMessage:string "User input",
  contextData:json "Background info" -> 
  responseText:string "AI response",
  sentiment:class "positive, negative, neutral" "Sentiment analysis",
  confidence:number "0-1 confidence score"
`)

// Create generator directly
const generator = ax(`
  userMessage:string "User input" -> 
  responseText:string "AI response"
`)
```

#### Field Types in String Signatures

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

### Advanced Field Usage
```typescript
// Optional fields with string syntax
const optionalSig = s(`
  userInput:string -> 
  response:string,
  metadata?:json "Optional extra data"
`)

// Array fields
const listProcessor = ax(`
  itemList:string[] "List items" -> 
  processedItems:string[] "Processed items",
  summary:string "Overall summary"
`)

// Complex nested structures
const structuredAnalysis = ax(`
  documentText:string "Document to analyze" -> 
  topics:string[] "Main topics",
  sentiment:class "positive, negative, neutral" "Sentiment analysis",
  keyPoints:string[] "Important points",
  actionItems?:string[] "Required actions"
`)

// Dynamic field creation using f helpers
const dynamicSig = s('baseField:string -> baseOutput:string')
  .appendInputField('extraField', f.optional(f.array(f.string('Dynamic field'))))
  .appendOutputField('confidence', f.number('Confidence score'))
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
import { ax, ai } from '@ax-llm/ax'

// 1. Create generator with ax function
const taskExtractor = ax(`
  meetingNotes:string "Raw meeting notes" -> 
  actionItems:string[] "Tasks to complete",
  decisions:string[] "Decisions made",
  nextMeetingDate?:date "Next meeting if mentioned"
`)

// 2. Set up AI provider using factory function
const llm = ai({ 
  name: 'openai', 
  apiKey: process.env.OPENAI_APIKEY!,
  config: { model: 'gpt-4' }
})

// 3. Execute the generator
const result = await taskExtractor.forward(llm, {
  meetingNotes: 'Discussed Q4 budget. John will review numbers by Friday. Next meeting Dec 15th.'
})

// 4. Access typed results
console.log(result.actionItems) // ['John will review Q4 budget numbers by Friday']
console.log(result.decisions)   // ['Discussed Q4 budget planning']
console.log(result.nextMeetingDate) // '2024-12-15'
```

#### Streaming with AxGen
```typescript
const streamingGen = ax(`
  storyPrompt:string "Story premise" -> 
  storyText:string "Generated story",
  genre:class "fantasy, sci-fi, mystery" "Story genre"
`)

// Stream the response
for await (const chunk of streamingGen.stream(llm, { 
  storyPrompt: 'A robot discovers emotions' 
})) {
  if (chunk.storyText) {
    process.stdout.write(chunk.storyText)
  }
}
```

### Advanced Signature Usage
```typescript
import { s, ax, ai } from '@ax-llm/ax'

// Create signature separately
const analysisSignature = s(`
  documentText:string "Document to analyze" -> 
  mainThemes:string[] "Key themes",
  readingLevel:class "elementary, middle, high, college" "Reading difficulty",
  wordCount:number "Approximate word count"
`)

// Create generator from signature
const analyzer = ax(analysisSignature.toString())

// Use the analyzer
const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_APIKEY! })
const result = await analyzer.forward(llm, { 
  documentText: 'Sample document text...' 
})
```

### Error Handling and Validation
```typescript
try {
  const result = await generator.forward(llm, { documentText: 'Sample text' })
  
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
const summarizer = ax(`
  longText:string "Text to summarize" -> 
  summary:string "Brief summary"
`)

const classifier = ax(`
  summaryText:string "Summary text" -> 
  category:class "news, opinion, tutorial" "Content type"
`)

// Chain execution
const summary = await summarizer.forward(llm, { longText: document })
const classification = await classifier.forward(llm, { summaryText: summary.summary })
```

**String-Based Function Advantages**:
- Full TypeScript type inference and safety
- Clean, readable syntax with `s()` and `ax()` functions
- Better IntelliSense support than template literals
- Consistent validation and error messages
- Standard string format that's easy to parse and understand
- Can combine with `f.<type>()` helpers for dynamic field creation
- Automatic TypeScript inference for input/output types

#### 2. Core Components
- **AxAI**: Main AI interface supporting 15+ LLM providers (use `ai()` factory function)
- **AxAgent**: Agent framework with inter-agent communication (use `agent()` factory function)
- **AxFlow**: AI workflow orchestration engine for complex multi-step processes
- **AxDB**: Vector database abstraction (Memory, Weaviate, Pinecone, Cloudflare)
- **AxDBManager**: Smart chunking, embedding, and querying
- **axRAG**: Modern RAG implementation built on AxFlow (replaces AxRAG)

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
1. **Creating AI Instance**: Always use `ai()` factory function: `ai({ name: 'provider', apiKey: '...' })`
2. **Signature Creation**: Use `s()` function for type-safe string-based signatures
3. **Generator Creation**: Use `ax()` function for direct generator creation
4. **Agent Creation**: Use `agent()` factory function OR `AxAgent.create()` static method for type safety
5. **Dynamic Fields**: Combine string signatures with `f.<type>()` helpers for dynamic field creation
6. **Signature Design**: Keep signatures simple and descriptive with meaningful field names
7. **Agent Composition**: Agents can call other agents for complex workflows  
8. **Streaming Handling**: Always handle both success and error states in streams
9. **Type Safety**: Leverage TypeScript's type system for compile-time validation
10. **Variable Naming**: Use `llm` instead of `ai` to avoid naming conflicts with factory function

## Build & Release
- Uses `tsup` for building
- Automated versioning with `standard-version`
- Multi-workspace publishing with `release-it`
- GitHub Actions for CI/CD
- **Auto-generated Files**: `index.ts` in the main library is auto-generated by running `npm run build:index --workspace=@ax-llm/ax`

## Current Best Practices (v13.0.24+)
- **Always use** factory functions: `ai()`, `agent()` for better type safety
- **Always use** `s()` function for string-based signatures (not constructors)
- **Always use** `ax()` function for generators (not template literals)
- **Import pattern**: `import { ai, agent, s, ax, f } from '@ax-llm/ax'`
- **Field naming**: Use descriptive names like `userQuestion`, `emailText`, `responseText`
- **Variable naming**: Use `llm` instead of `ai` to avoid naming conflicts
- **Dynamic fields**: Use `f.<type>()` helpers with signature methods for dynamic field creation
- **Type safety**: Leverage string-based functions for full TypeScript inference

## Documentation Guidelines
- When implementing big new features, **ask to update the top-level README.md** with examples and documentation
- Include the new feature in the feature list and provide clear usage examples
- Update TypeDoc comments for new APIs
- Add corresponding examples in `src/examples/` for new functionality
- **When creating new examples, always add them to the examples table in the top-level README.md** with a clear description
- **ALL examples must use current recommended patterns** (factory functions, string-based signatures) instead of deprecated patterns
- **IMPORTANT**: Only edit the top-level `README.md` file. Never edit files under `src/docs/src/content/` as they are auto-generated and will be overwritten

Remember: This is a production-ready library used by startups in production. Maintain high code quality, comprehensive testing, and backward compatibility. 