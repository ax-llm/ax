---
name: ax-llm
description: This skill helps with using the @ax-llm/ax TypeScript library for building LLM applications. Use when the user asks about ax(), ai(), f(), s(), agent(), flow(), AxGen, AxAgent, AxFlow, signatures, streaming, or mentions @ax-llm/ax.
version: "__VERSION__"
---

# Ax Library (@ax-llm/ax) Usage Guide

Ax is a TypeScript library for building LLM-powered applications with type-safe signatures, streaming support, and multi-provider compatibility.

## Quick Reference

```typescript
import { ax, ai, s, f, agent, flow, AxGen, AxAgent, AxFlow } from '@ax-llm/ax';

// Create AI provider
const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_API_KEY });

// Create typed generator
const gen = ax('question:string -> answer:string');
const result = await gen.forward(llm, { question: 'What is 2+2?' });
// result.answer is typed as string

// Create signature separately
const sig = s('text:string -> summary:string');

// Field builders for programmatic signatures
const customSig = f()
  .input('text', f.string('Input text'))
  .output('summary', f.string('Summary output'))
  .build();
```

## 1. AI Provider Setup

### Quick Setup (All Providers)

```typescript
import { ai } from '@ax-llm/ax';

// OpenAI
const openai = ai({ name: 'openai', apiKey: 'sk-...' });

// Anthropic Claude
const claude = ai({ name: 'anthropic', apiKey: 'sk-ant-...' });

// Google Gemini
const gemini = ai({ name: 'google-gemini', apiKey: 'AIza...' });

// Azure OpenAI
const azure = ai({
  name: 'azure-openai',
  apiKey: 'your-key',
  resourceName: 'your-resource',
  deploymentName: 'gpt-4'
});

// Groq
const groq = ai({ name: 'groq', apiKey: 'gsk_...' });

// DeepSeek
const deepseek = ai({ name: 'deepseek', apiKey: 'sk-...' });

// Mistral
const mistral = ai({ name: 'mistral', apiKey: 'your-key' });

// Cohere
const cohere = ai({ name: 'cohere', apiKey: 'your-key' });

// Together AI
const together = ai({ name: 'together', apiKey: 'your-key' });

// OpenRouter
const openrouter = ai({ name: 'openrouter', apiKey: 'your-key' });

// Ollama (local)
const ollama = ai({ name: 'ollama', url: 'http://localhost:11434' });

// HuggingFace
const hf = ai({ name: 'huggingface', apiKey: 'hf_...' });

// Reka
const reka = ai({ name: 'reka', apiKey: 'your-key' });

// xAI Grok
const grok = ai({ name: 'grok', apiKey: 'your-key' });
```

### Full Provider Example

```typescript
import { ai, ax } from '@ax-llm/ax';

// Create provider with options
const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_API_KEY!,
  config: {
    model: 'gpt-4o',
    temperature: 0.7,
    maxTokens: 1000
  }
});

// Use with generator
const gen = ax('topic:string -> essay:string "A short essay"');
const result = await gen.forward(llm, { topic: 'Climate change' });
console.log(result.essay);
```

## 2. Signatures & Generators

### String Signature Syntax

```
[description] inputField:type ["field desc"], ... -> outputField:type ["field desc"], ...
```

**Types:** `string`, `number`, `boolean`, `json`, `class`, `date`, `datetime`, `image`, `audio`, `file`, `code`, `url`

**Modifiers:**
- `field?:type` - Optional field
- `field:type[]` - Array type
- `field:class "opt1, opt2, opt3"` - Enum/classification

### Signature Examples

```typescript
import { ax, s } from '@ax-llm/ax';

// Basic signature
const gen1 = ax('question:string -> answer:string');

// With descriptions
const gen2 = ax('question:string "User question" -> answer:string "AI response"');

// Optional fields
const gen3 = ax('query:string, context?:string -> response:string');

// Arrays
const gen4 = ax('text:string -> keywords:string[]');

// Classification (enum)
const gen5 = ax('review:string -> sentiment:class "positive, negative, neutral"');

// Multiple outputs
const gen6 = ax('article:string -> title:string, summary:string, tags:string[]');

// Numbers and booleans
const gen7 = ax('text:string -> wordCount:number, isQuestion:boolean');

// JSON output
const gen8 = ax('data:string -> parsed:json');

// Dates
const gen9 = ax('text:string -> extractedDate:date');

// Code blocks
const gen10 = ax('task:string -> code:code "python"');

// Signature description
const gen11 = ax('"Translate text to French" text:string -> translation:string');

// Using s() for signature only
const sig = s('input:string -> output:string');
```

### Complete Generator Example

```typescript
import { ai, ax } from '@ax-llm/ax';

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_API_KEY! });

// Create generator with options
const summarizer = ax('article:string -> summary:string, keyPoints:string[]', {
  description: 'Summarize articles and extract key points',
  maxRetries: 3,
  maxSteps: 5
});

// Forward (non-streaming)
const result = await summarizer.forward(llm, {
  article: 'Long article text here...'
});

console.log(result.summary);      // string
console.log(result.keyPoints);    // string[]

// With model override
const result2 = await summarizer.forward(llm, { article: 'text' }, {
  model: 'gpt-4o-mini'
});
```

## 3. Field Builders (f.xxx())

Use field builders for programmatic signature creation with full type safety.

### Basic Field Types

```typescript
import { f } from '@ax-llm/ax';

// Start a signature builder
const sig = f()
  .input('userQuery', f.string('The user question'))
  .input('context', f.string('Background context').optional())
  .output('response', f.string('AI response'))
  .output('confidence', f.number('Confidence score 0-1'))
  .output('isComplete', f.boolean('Whether response is complete'))
  .description('Answer questions with confidence scoring')
  .build();
```

### All Field Types

```typescript
import { f } from '@ax-llm/ax';

// String types
f.string('description')               // Basic string
f.string().min(10).max(1000)          // With length constraints
f.string().email()                    // Email validation
f.string().url()                      // URL validation
f.string().regex('^[A-Z]', 'Start with capital') // Pattern

// Numbers
f.number('description')
f.number().min(0).max(100)            // With range

// Boolean
f.boolean('description')

// Classification/Enum
f.class(['option1', 'option2', 'option3'], 'description')

// JSON (any structure)
f.json('description')

// Dates and times
f.date('description')
f.datetime('description')

// Media (input only)
f.image('description')
f.audio('description')
f.file('description')

// Code
f.code('python', 'description')

// URL
f.url('description')

// Nested objects
f.object({
  name: f.string('Person name'),
  age: f.number('Age in years'),
  email: f.string().email()
}, 'Person details')

// Arrays
f.string('Item description').array('List of items')
f.object({ id: f.number(), name: f.string() }).array('List of objects')

// Modifiers
f.string().optional()                  // Optional field
f.string().internal()                  // Internal (not shown to LLM)
f.string().cache()                     // Enable caching
```

### Complete Field Builder Example

```typescript
import { ai, ax, f } from '@ax-llm/ax';

// Build a complex signature
const analysisSig = f()
  .input('document', f.string('Document to analyze'))
  .input('analysisType', f.class(['sentiment', 'entities', 'summary']))
  .output('result', f.object({
    score: f.number().min(0).max(1),
    label: f.string(),
    details: f.string().optional()
  }))
  .output('entities', f.object({
    name: f.string(),
    type: f.class(['person', 'org', 'location'])
  }).array().optional())
  .description('Analyze documents')
  .build();

// Create generator from signature
const analyzer = ax(analysisSig);

const llm = ai({ name: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY! });

const result = await analyzer.forward(llm, {
  document: 'Apple Inc. announced new products in Cupertino.',
  analysisType: 'entities'
});

// Fully typed result
console.log(result.result.score);
console.log(result.entities?.[0]?.name);
```

## 4. Streaming

### Basic Streaming

```typescript
import { ai, ax } from '@ax-llm/ax';

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_API_KEY! });
const gen = ax('topic:string -> content:string');

// Stream responses
for await (const chunk of gen.streamingForward(llm, { topic: 'AI' })) {
  // chunk.delta contains partial values
  if (chunk.delta.content) {
    process.stdout.write(chunk.delta.content);
  }
}
```

### Complete Streaming Example

```typescript
import { ai, ax } from '@ax-llm/ax';

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_API_KEY! });

const writer = ax('prompt:string -> story:string, title:string');

async function streamStory() {
  let fullStory = '';
  let title = '';

  for await (const chunk of writer.streamingForward(
    llm,
    { prompt: 'Write a short story about a robot' },
    { stream: true }
  )) {
    // Handle story chunks
    if (chunk.delta.story) {
      process.stdout.write(chunk.delta.story);
      fullStory += chunk.delta.story;
    }

    // Handle title (usually comes early)
    if (chunk.delta.title) {
      title = chunk.delta.title;
    }
  }

  console.log('\n\nTitle:', title);
  return { story: fullStory, title };
}

await streamStory();
```

### Streaming with Field Processors

```typescript
import { ai, ax } from '@ax-llm/ax';

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_API_KEY! });

const gen = ax('query:string -> response:string');

// Add streaming field processor
gen.addStreamingFieldProcessor('response', (chunk, context) => {
  console.log('Chunk received:', chunk);
  console.log('Full value so far:', context?.values?.response);
  console.log('Done:', context?.done);
});

await gen.forward(llm, { query: 'Hello' }, { stream: true });
```

## 5. Agents with Tools

Agents can use functions (tools) to perform actions.

### Defining Functions

```typescript
import { ai, agent } from '@ax-llm/ax';

// Function definition
const getCurrentWeather = {
  name: 'getCurrentWeather',
  description: 'Get the current weather for a location',
  parameters: {
    type: 'object',
    properties: {
      location: { type: 'string', description: 'City name' },
      unit: { type: 'string', enum: ['celsius', 'fahrenheit'] }
    },
    required: ['location']
  },
  func: async ({ location, unit = 'celsius' }) => {
    // Implementation
    return JSON.stringify({ temp: 22, unit, location });
  }
};
```

### Creating Agents

```typescript
import { ai, agent } from '@ax-llm/ax';

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_API_KEY! });

// Create agent with functions
const weatherAgent = agent('query:string -> response:string', {
  name: 'weatherAssistant',
  description: 'An assistant that helps with weather queries',
  definition: 'You are a helpful weather assistant. Use the getCurrentWeather function to get weather data and provide friendly responses.',
  functions: [getCurrentWeather]
});

const result = await weatherAgent.forward(llm, {
  query: 'What is the weather in Tokyo?'
});

console.log(result.response);
```

### Complete Agent Example

```typescript
import { ai, agent } from '@ax-llm/ax';

// Define tools
const searchDatabase = {
  name: 'searchDatabase',
  description: 'Search the product database',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      limit: { type: 'number', description: 'Max results' }
    },
    required: ['query']
  },
  func: async ({ query, limit = 5 }) => {
    // Simulate database search
    return JSON.stringify([
      { id: 1, name: 'Product A', price: 99 },
      { id: 2, name: 'Product B', price: 149 }
    ].slice(0, limit));
  }
};

const getProductDetails = {
  name: 'getProductDetails',
  description: 'Get details of a specific product',
  parameters: {
    type: 'object',
    properties: {
      productId: { type: 'number', description: 'Product ID' }
    },
    required: ['productId']
  },
  func: async ({ productId }) => {
    return JSON.stringify({
      id: productId,
      name: 'Product A',
      price: 99,
      description: 'A great product',
      stock: 50
    });
  }
};

// Create agent
const shopAssistant = agent(
  'userQuery:string -> response:string, recommendations:string[]',
  {
    name: 'shoppingAssistant',
    description: 'An AI assistant that helps users find and learn about products',
    definition: `You are a helpful shopping assistant. Use the available tools to:
1. Search for products when users ask about items
2. Get product details when they want more information
3. Provide helpful recommendations based on their needs

Always be friendly and provide clear, helpful responses.`,
    functions: [searchDatabase, getProductDetails]
  }
);

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_API_KEY! });

const result = await shopAssistant.forward(llm, {
  userQuery: 'Can you find me some products and tell me about the first one?'
});

console.log('Response:', result.response);
console.log('Recommendations:', result.recommendations);
```

### Nested Agents

```typescript
import { ai, agent } from '@ax-llm/ax';

// Child agent
const researcher = agent('topic:string -> findings:string', {
  name: 'researchAgent',
  description: 'Researches topics and provides detailed findings'
});

// Parent agent that can use child agent
const writer = agent('topic:string -> article:string', {
  name: 'writerAgent',
  description: 'Writes articles using research from the research agent',
  agents: [researcher]
});

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_API_KEY! });

const result = await writer.forward(llm, {
  topic: 'Benefits of meditation'
});
```

## 6. Workflows (AxFlow)

AxFlow enables building complex, multi-step AI workflows with type safety.

### Basic Flow

```typescript
import { ai, flow } from '@ax-llm/ax';

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_API_KEY! });

const pipeline = flow<{ text: string }, { result: string }>()
  .node('summarizer', 'text:string -> summary:string')
  .node('translator', 'text:string -> translation:string')
  .execute('summarizer', (state) => ({ text: state.text }))
  .execute('translator', (state) => ({ text: state.summarizerResult.summary }))
  .map((state) => ({ result: state.translatorResult.translation }));

const result = await pipeline.forward(llm, { text: 'Long article...' });
console.log(result.result);
```

### Flow with Branching

```typescript
import { ai, flow } from '@ax-llm/ax';

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_API_KEY! });

const workflow = flow<{ query: string; type: string }, { output: string }>()
  .node('technical', 'query:string -> answer:string')
  .node('creative', 'query:string -> answer:string')
  .branch(
    (state) => state.type === 'technical',
    (branch) => branch.execute('technical', (s) => ({ query: s.query })),
    (branch) => branch.execute('creative', (s) => ({ query: s.query }))
  )
  .map((state) => ({
    output: state.technicalResult?.answer || state.creativeResult?.answer || ''
  }));

const result = await workflow.forward(llm, {
  query: 'Explain quantum computing',
  type: 'technical'
});
```

### Flow with Parallel Execution

```typescript
import { ai, flow } from '@ax-llm/ax';

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_API_KEY! });

const parallelFlow = flow<{ topic: string }, { combined: string }>()
  .node('pros', 'topic:string -> arguments:string')
  .node('cons', 'topic:string -> arguments:string')
  .node('summary', 'prosArgs:string, consArgs:string -> summary:string')
  .parallel([
    { branch: (b) => b.execute('pros', (s) => ({ topic: s.topic })) },
    { branch: (b) => b.execute('cons', (s) => ({ topic: s.topic })) }
  ])
  .execute('summary', (state) => ({
    prosArgs: state.prosResult.arguments,
    consArgs: state.consResult.arguments
  }))
  .map((state) => ({ combined: state.summaryResult.summary }));

const result = await parallelFlow.forward(llm, { topic: 'Remote work' });
```

### Complete Flow Example

```typescript
import { ai, flow, f } from '@ax-llm/ax';

// Define nodes with proper signatures
const researchNode = f()
  .input('topic', f.string())
  .output('research', f.string())
  .output('sources', f.string().array())
  .build();

const outlineNode = f()
  .input('research', f.string())
  .input('sources', f.string().array())
  .output('outline', f.string().array())
  .build();

const writeNode = f()
  .input('outline', f.string().array())
  .input('research', f.string())
  .output('draft', f.string())
  .build();

const editNode = f()
  .input('draft', f.string())
  .output('final', f.string())
  .output('wordCount', f.number())
  .build();

// Build the flow
const articlePipeline = flow<
  { topic: string },
  { article: string; wordCount: number }
>()
  .node('research', researchNode)
  .node('outline', outlineNode)
  .node('write', writeNode)
  .node('edit', editNode)
  .execute('research', (s) => ({ topic: s.topic }))
  .execute('outline', (s) => ({
    research: s.researchResult.research,
    sources: s.researchResult.sources
  }))
  .execute('write', (s) => ({
    outline: s.outlineResult.outline,
    research: s.researchResult.research
  }))
  .execute('edit', (s) => ({
    draft: s.writeResult.draft
  }))
  .map((s) => ({
    article: s.editResult.final,
    wordCount: s.editResult.wordCount
  }));

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_API_KEY! });

const result = await articlePipeline.forward(llm, {
  topic: 'The future of renewable energy'
});

console.log('Article:', result.article);
console.log('Word count:', result.wordCount);
```

## 7. Common Patterns

### Classification

```typescript
import { ai, ax } from '@ax-llm/ax';

const classifier = ax(
  'text:string -> category:class "spam, ham, uncertain", confidence:number'
);

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_API_KEY! });

const result = await classifier.forward(llm, {
  text: 'Congratulations! You won $1,000,000!'
});

console.log(result.category);    // 'spam'
console.log(result.confidence);  // 0.95
```

### Extraction

```typescript
import { ai, ax, f } from '@ax-llm/ax';

// Using string syntax
const extractor = ax(`
  text:string ->
  people:string[],
  organizations:string[],
  locations:string[],
  dates:date[]
`);

// Or with field builders for structured output
const structuredExtractor = ax(
  f()
    .input('text', f.string())
    .output('entities', f.object({
      people: f.string().array(),
      organizations: f.string().array(),
      locations: f.string().array()
    }))
    .build()
);

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_API_KEY! });

const result = await extractor.forward(llm, {
  text: 'Tim Cook announced that Apple will open a new store in Paris on January 15th.'
});

console.log(result.people);        // ['Tim Cook']
console.log(result.organizations); // ['Apple']
console.log(result.locations);     // ['Paris']
```

### Multi-modal (Images)

```typescript
import { ai, ax, f } from '@ax-llm/ax';
import { readFileSync } from 'fs';

const imageAnalyzer = ax(
  f()
    .input('image', f.image('Image to analyze'))
    .input('question', f.string('Question about the image').optional())
    .output('description', f.string('Image description'))
    .output('objects', f.string().array())
    .build()
);

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_API_KEY! });

// From file
const imageData = readFileSync('./photo.jpg').toString('base64');
const result = await imageAnalyzer.forward(llm, {
  image: { mimeType: 'image/jpeg', data: imageData },
  question: 'What objects are in this image?'
});

// From URL (for providers that support it)
const result2 = await imageAnalyzer.forward(llm, {
  image: { mimeType: 'image/jpeg', url: 'https://example.com/image.jpg' }
});
```

### Chaining Generators

```typescript
import { ai, ax } from '@ax-llm/ax';

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_API_KEY! });

// Define generators
const researcher = ax('topic:string -> research:string, keyFacts:string[]');
const writer = ax('research:string, keyFacts:string[] -> article:string');
const editor = ax('article:string -> editedArticle:string, suggestions:string[]');

// Chain them
async function createArticle(topic: string) {
  const research = await researcher.forward(llm, { topic });

  const draft = await writer.forward(llm, {
    research: research.research,
    keyFacts: research.keyFacts
  });

  const final = await editor.forward(llm, {
    article: draft.article
  });

  return final;
}

const result = await createArticle('Artificial General Intelligence');
console.log(result.editedArticle);
```

### Error Handling

```typescript
import { ai, ax, AxGenerateError, AxAIServiceError } from '@ax-llm/ax';

const gen = ax('input:string -> output:string');
const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_API_KEY! });

try {
  const result = await gen.forward(llm, { input: 'test' });
  console.log(result.output);
} catch (error) {
  if (error instanceof AxGenerateError) {
    console.error('Generation failed:', error.message);
    console.error('Details:', error.details);
  } else if (error instanceof AxAIServiceError) {
    console.error('AI service error:', error.message);
  } else {
    throw error;
  }
}
```

### Examples and Few-Shot Learning

```typescript
import { ai, ax } from '@ax-llm/ax';

const classifier = ax('text:string -> sentiment:class "positive, negative, neutral"');

// Set examples for few-shot learning
classifier.setExamples([
  { text: 'I love this product!', sentiment: 'positive' },
  { text: 'This is terrible.', sentiment: 'negative' },
  { text: 'It works as expected.', sentiment: 'neutral' }
]);

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_API_KEY! });

const result = await classifier.forward(llm, {
  text: 'The quality exceeded my expectations!'
});
```

### Assertions and Validation

```typescript
import { ai, ax } from '@ax-llm/ax';

const gen = ax('number:number -> doubled:number');

// Add assertion
gen.addAssert(
  (output) => output.doubled === output.number * 2,
  'Output must be double the input'
);

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_API_KEY! });

// This will retry if assertion fails
const result = await gen.forward(llm, { number: 5 }, { maxRetries: 3 });
```

### Memory and Context

```typescript
import { ai, ax, AxMemory } from '@ax-llm/ax';

const chatbot = ax('userMessage:string -> response:string');
const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_API_KEY! });

// Create shared memory
const memory = new AxMemory();

// Conversation with memory
await chatbot.forward(llm, { userMessage: 'My name is Alice' }, { mem: memory });
const response = await chatbot.forward(llm, { userMessage: 'What is my name?' }, { mem: memory });
// response.response will reference "Alice"
```

## 8. Advanced Configuration

### Model Configuration

```typescript
import { ai, ax } from '@ax-llm/ax';

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_API_KEY! });
const gen = ax('input:string -> output:string');

const result = await gen.forward(llm, { input: 'test' }, {
  model: 'gpt-4o',
  modelConfig: {
    temperature: 0.7,
    maxTokens: 2000,
    topP: 0.9
  }
});
```

### Debugging

```typescript
import { ai, ax, axCreateDefaultColorLogger } from '@ax-llm/ax';

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_API_KEY! });
const gen = ax('input:string -> output:string');

// Enable debug logging
const result = await gen.forward(llm, { input: 'test' }, {
  debug: true,
  logger: axCreateDefaultColorLogger()
});
```

### Context Caching

```typescript
import { ai, ax } from '@ax-llm/ax';

const gen = ax('document:string, question:string -> answer:string');
const llm = ai({ name: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY! });

// Enable context caching for long documents
const result = await gen.forward(llm, {
  document: longDocument,
  question: 'What is the main topic?'
}, {
  contextCache: {
    cacheBreakpoint: 'after-examples'
  }
});
```

## 9. Forward & AI Options

### Quick Reference Table

| Goal | Option | Example |
|------|--------|---------|
| Adjust creativity | `modelConfig.temperature` | `{ modelConfig: { temperature: 0.8 } }` |
| Limit response length | `modelConfig.maxTokens` | `{ modelConfig: { maxTokens: 500 } }` |
| Use different model | `model` | `{ model: 'gpt-4o-mini' }` |
| Enable caching | `contextCache` | `{ contextCache: { cacheBreakpoint: 'after-examples' } }` |
| Debug output | `debug` | `{ debug: true }` |
| Retry on failure | `maxRetries` | `{ maxRetries: 3 }` |
| Multi-sampling | `sampleCount` | `{ sampleCount: 5, resultPicker: bestResultPicker }` |
| Thinking models | `thinkingTokenBudget` | `{ thinkingTokenBudget: 10000 }` |
| Abort request | `abortSignal` | `{ abortSignal: controller.signal }` |
| Custom timeout | `timeout` | `{ timeout: 60000 }` |

### Execution Control Options

```typescript
import { ai, ax } from '@ax-llm/ax';

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_API_KEY! });
const gen = ax('input:string -> output:string');

const result = await gen.forward(llm, { input: 'test' }, {
  // Retry failed generations (validation failures, API errors)
  maxRetries: 3,

  // Maximum agentic steps (for agents with tools)
  maxSteps: 10,

  // Fail immediately on first error (don't retry)
  fastFail: true
});
```

### Model Configuration

```typescript
import { ai, ax } from '@ax-llm/ax';

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_API_KEY! });
const gen = ax('input:string -> output:string');

const result = await gen.forward(llm, { input: 'test' }, {
  // Override the model for this request
  model: 'gpt-4o-mini',

  // Model-specific configuration
  modelConfig: {
    // Sampling temperature (0.0 = deterministic, 2.0 = creative)
    temperature: 0.7,

    // Maximum tokens in response
    maxTokens: 2000,

    // Nucleus sampling threshold
    topP: 0.9,

    // Top-K sampling (not all providers support this)
    topK: 40,

    // Frequency penalty (-2.0 to 2.0)
    frequencyPenalty: 0.5,

    // Presence penalty (-2.0 to 2.0)
    presencePenalty: 0.5,

    // Stop sequences
    stopSequences: ['\n\n', 'END'],

    // Seed for reproducible outputs (when supported)
    seed: 12345,

    // Response format
    responseFormat: 'json_object'
  }
});
```

### Context Caching (Gemini/Anthropic)

Context caching saves costs when repeatedly querying with the same large context (documents, system prompts, examples).

```typescript
import { ai, ax } from '@ax-llm/ax';

const llm = ai({ name: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY! });
const gen = ax('document:string, question:string -> answer:string');

const longDocument = '... very long document ...';

// Multiple questions about the same document - caching saves cost
for (const question of questions) {
  const result = await gen.forward(llm, { document: longDocument, question }, {
    contextCache: {
      // Cache name (required for identifying the cache)
      name: 'doc-analysis-cache',

      // Where to split the prompt for caching:
      // - 'system': Cache system prompt only
      // - 'after-functions': Cache system + function definitions
      // - 'after-examples': Cache system + functions + examples
      cacheBreakpoint: 'after-examples',

      // Cache time-to-live in seconds (default: provider-specific)
      ttlSeconds: 3600,

      // Minimum tokens to trigger caching (avoid caching small prompts)
      minTokens: 1000,

      // Refresh cache when within this window of expiry
      refreshWindowSeconds: 300,

      // Custom cache registry for external storage (Redis, etc.)
      registry: customCacheRegistry
    }
  });
}
```

### Thinking Models (o1, o3, Gemini 2.0 Flash Thinking)

For reasoning models that support extended thinking:

```typescript
import { ai, ax } from '@ax-llm/ax';

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_API_KEY! });
const gen = ax('problem:string -> solution:string');

const result = await gen.forward(llm, { problem: 'Complex math problem' }, {
  model: 'o1',

  // Token budget for thinking/reasoning (model-specific)
  thinkingTokenBudget: 10000,

  // Include thinking in output (when supported)
  showThoughts: true,

  // Custom field name for thoughts in output
  thoughtFieldName: 'reasoning'
});
```

### Multi-Sampling for Quality

Generate multiple samples and pick the best one:

```typescript
import { ai, ax } from '@ax-llm/ax';

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_API_KEY! });
const gen = ax('input:string -> output:string, confidence:number');

const result = await gen.forward(llm, { input: 'test' }, {
  // Generate multiple samples
  sampleCount: 5,

  // Pick the best result (custom function)
  resultPicker: (results) => {
    // Return the result with highest confidence
    return results.reduce((best, current) =>
      current.confidence > best.confidence ? current : best
    );
  }
});
```

### Function Calling Configuration

Control how agents use tools/functions:

```typescript
import { ai, agent } from '@ax-llm/ax';

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_API_KEY! });

const myAgent = agent('query:string -> answer:string', {
  functions: [searchTool, calculatorTool]
});

const result = await myAgent.forward(llm, { query: 'test' }, {
  // Function calling mode:
  // - 'auto': Model decides when to call functions
  // - 'none': Disable function calling
  // - 'required': Force at least one function call
  functionCallMode: 'auto',

  // Force a specific function to be called
  functionCall: 'searchTool',

  // Stop after this function is called
  stopFunction: 'finalAnswer',

  // Override available functions for this request
  functions: [searchTool],

  // Custom caching for function results
  cachingFunction: async (funcName, args) => {
    const cacheKey = `${funcName}:${JSON.stringify(args)}`;
    return await cache.get(cacheKey);
  }
});
```

### Debugging & Observability

```typescript
import { ai, ax, axCreateDefaultColorLogger } from '@ax-llm/ax';

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_API_KEY! });
const gen = ax('input:string -> output:string');

const result = await gen.forward(llm, { input: 'test' }, {
  // Enable debug logging
  debug: true,

  // Show verbose output (more details)
  verbose: true,

  // Hide system prompt in debug output (security)
  debugHideSystemPrompt: true,

  // Custom logger
  logger: axCreateDefaultColorLogger(),

  // OpenTelemetry tracer for distributed tracing
  tracer: openTelemetryTracer,

  // OpenTelemetry meter for metrics
  meter: openTelemetryMeter,

  // Parent trace context
  traceContext: parentSpan,

  // Custom labels for traces/metrics
  customLabels: { environment: 'production', version: '1.0' },

  // Exclude content from traces (privacy)
  excludeContentFromTrace: true
});
```

### Retry & Error Handling

```typescript
import { ai, ax } from '@ax-llm/ax';

const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_API_KEY!,
  options: {
    // Retry configuration for API calls
    retry: {
      // Maximum retry attempts
      maxRetries: 3,

      // Initial delay between retries (ms)
      initialDelayMs: 1000,

      // Maximum delay between retries (ms)
      maxDelayMs: 30000,

      // Backoff multiplier
      backoffMultiplier: 2,

      // Jitter factor (0-1) to randomize delays
      jitterFactor: 0.1,

      // HTTP status codes to retry on
      retryOnStatusCodes: [429, 500, 502, 503, 504]
    },

    // Rate limiter for API calls
    rateLimiter: customRateLimiter,

    // Request timeout (ms)
    timeout: 60000
  }
});
```

### Request Control

```typescript
import { ai, ax } from '@ax-llm/ax';

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_API_KEY! });
const gen = ax('input:string -> output:string');

// Create abort controller
const controller = new AbortController();

// Cancel after 5 seconds
setTimeout(() => controller.abort(), 5000);

try {
  const result = await gen.forward(llm, { input: 'test' }, {
    // Abort signal for cancellation
    abortSignal: controller.signal,

    // Request timeout (ms)
    timeout: 30000,

    // Custom fetch function (for proxies, etc.)
    fetch: customFetch,

    // CORS proxy URL (for browser environments)
    corsProxy: 'https://cors-proxy.example.com'
  });
} catch (error) {
  if (error.name === 'AbortError') {
    console.log('Request was cancelled');
  }
}
```

### Memory Configuration

```typescript
import { ai, ax, AxMemory } from '@ax-llm/ax';

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_API_KEY! });
const gen = ax('message:string -> response:string');

const memory = new AxMemory();

const result = await gen.forward(llm, { message: 'Hello' }, {
  // Use shared memory for conversation context
  mem: memory,

  // Disable automatic memory cleanup (keep all messages)
  disableMemoryCleanup: true
});
```

### Validation Options

```typescript
import { ai, ax } from '@ax-llm/ax';

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_API_KEY! });
const gen = ax('input:string -> output:string');

const result = await gen.forward(llm, { input: 'test' }, {
  // Strict mode: fail on any validation error
  strictMode: true,

  // Custom assertions (run after generation)
  asserts: [
    {
      fn: (output) => output.output.length > 10,
      message: 'Output must be longer than 10 characters'
    }
  ],

  // Streaming assertions (run during streaming)
  streamingAsserts: [
    {
      fn: (partial) => !partial.output?.includes('forbidden'),
      message: 'Output must not contain forbidden content'
    }
  ]
});
```

## 10. MCP Integration

MCP (Model Context Protocol) enables AxAgent to use external tools from MCP-compliant servers. This allows your agents to interact with databases, file systems, APIs, and other services through a standardized protocol.

### Quick Start

```typescript
import { AxAgent, AxAI, AxMCPClient } from '@ax-llm/ax';
import { AxMCPStdioTransport } from '@ax-llm/ax-tools';

// Create transport for local MCP server
const transport = new AxMCPStdioTransport({
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-memory'],
});

// Initialize MCP client
const mcpClient = new AxMCPClient(transport, { debug: false });
await mcpClient.init();

// Create agent with MCP functions
const agent = new AxAgent({
  name: 'MyAssistant',
  description: 'An assistant with MCP capabilities',
  signature: 'userMessage -> response',
  functions: [mcpClient],  // Pass client directly
});

const ai = new AxAI({ name: 'openai', apiKey: process.env.OPENAI_API_KEY! });
const result = await agent.forward(ai, { userMessage: 'Hello' });
```

### MCP Transports

#### AxMCPStdioTransport (Local Servers)

For MCP servers that run as local processes via stdin/stdout:

```typescript
import { AxMCPStdioTransport } from '@ax-llm/ax-tools';

const transport = new AxMCPStdioTransport({
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-memory'],
});

// Clean up when done
await transport.terminate();
```

#### AxMCPStreambleHTTPTransport (Remote Servers)

For MCP servers accessible via HTTP (e.g., Pipedream, hosted services):

```typescript
import { AxMCPStreambleHTTPTransport } from '@ax-llm/ax/mcp/transports/httpStreamTransport.js';

const transport = new AxMCPStreambleHTTPTransport(
  'https://remote.mcp.pipedream.net',
  {
    headers: {
      'x-pd-project-id': projectId,
      'x-pd-environment': 'development',
      'x-pd-external-user-id': 'user123',
      'x-pd-app-slug': 'notion',
    },
    authorization: `Bearer ${accessToken}`,
  }
);
```

### Using MCP with Agents

Pass the MCP client directly to the agent's `functions` array:

```typescript
import { AxAgent, AxAI, AxMCPClient } from '@ax-llm/ax';
import { AxMCPStdioTransport } from '@ax-llm/ax-tools';

const transport = new AxMCPStdioTransport({
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-memory'],
});

const mcpClient = new AxMCPClient(transport);
await mcpClient.init();

const memoryAgent = new AxAgent<
  { userMessage: string; userId: string },
  { assistantResponse: string }
>({
  name: 'MemoryAssistant',
  description: 'An assistant that remembers past conversations. Use the database functions to manage, search, and add memories.',
  signature: 'userMessage, userId -> assistantResponse',
  functions: [mcpClient],
});

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_API_KEY!,
  config: { model: 'gpt-4o-mini' }
});

// First interaction - stores memory
const first = await memoryAgent.forward(ai, {
  userMessage: 'My name is Alice and my favorite color is blue.',
  userId: 'user123',
});

// Later interaction - retrieves memory
const second = await memoryAgent.forward(ai, {
  userMessage: "What's my favorite color?",
  userId: 'user123',
});
```

### MCP Capabilities

MCP servers can provide three types of capabilities:

| Capability | Function Prefix | Description |
|------------|-----------------|-------------|
| **Tools** | *(none)* | Traditional function calls (e.g., `search`, `create`) |
| **Prompts** | `prompt_` | Prompt templates (e.g., `prompt_summarize`) |
| **Resources** | `resource_` | File/data access (e.g., `resource_config_json`) |

Check available capabilities:

```typescript
const mcpClient = new AxMCPClient(transport);
await mcpClient.init();

const caps = mcpClient.getCapabilities();
console.log('Tools:', caps.tools);      // true/false
console.log('Prompts:', caps.prompts);  // true/false
console.log('Resources:', caps.resources); // true/false

// Or check individually
if (mcpClient.hasToolsCapability()) {
  console.log('Server supports tools');
}
```

### Function Overrides

Customize function names and descriptions while preserving functionality:

```typescript
const mcpClient = new AxMCPClient(transport, {
  functionOverrides: [
    {
      name: 'search_documents',
      updates: {
        name: 'findDocs',
        description: 'Search through all available documents'
      }
    },
    {
      name: 'prompt_summarize',
      updates: {
        name: 'getSummaryPrompt',
        description: 'Get a prompt template for summarization'
      }
    }
  ]
});
```

### Getting Functions Directly

If you need the function array instead of passing the client:

```typescript
const mcpClient = new AxMCPClient(transport);
await mcpClient.init();

// Get all functions (tools + prompts + resources)
const functions = mcpClient.toFunction();

// Use with agent
const agent = new AxAgent({
  name: 'MyAgent',
  signature: 'query -> answer',
  functions: functions,  // Or spread: [...functions, otherFunction]
});
```

### Complete Example: Remote HTTP MCP Server

```typescript
import { AxAgent, AxAI, AxMCPClient } from '@ax-llm/ax';
import { AxMCPStreambleHTTPTransport } from '@ax-llm/ax/mcp/transports/httpStreamTransport.js';
import { createBackendClient } from '@pipedream/sdk/server';

// Initialize Pipedream SDK
const pd = createBackendClient({
  environment: 'development',
  credentials: {
    clientId: process.env.PIPEDREAM_CLIENT_ID!,
    clientSecret: process.env.PIPEDREAM_CLIENT_SECRET!,
  },
  projectId: process.env.PIPEDREAM_PROJECT_ID!,
});

// Get access token and app info
const accessToken = await pd.rawAccessToken();
const apps = await pd.getApps({ q: 'notion' });
const appSlug = apps.data[0]?.name_slug;

// Create HTTP transport for Pipedream MCP
const httpTransport = new AxMCPStreambleHTTPTransport(
  'https://remote.mcp.pipedream.net',
  {
    headers: {
      'x-pd-project-id': process.env.PIPEDREAM_PROJECT_ID!,
      'x-pd-environment': 'development',
      'x-pd-external-user-id': 'user123',
      'x-pd-app-slug': appSlug!,
    },
    authorization: `Bearer ${accessToken}`,
  }
);

// Initialize MCP client
const mcpClient = new AxMCPClient(httpTransport, { debug: false });
await mcpClient.init();

// Create Notion agent
const notionAgent = new AxAgent<
  { userRequest: string },
  { assistantResponse: string }
>({
  name: 'NotionAssistant',
  description: 'An assistant that can interact with Notion documents. Use the provided functions to read, search, and analyze Notion content.',
  signature: 'userRequest -> assistantResponse',
  functions: [mcpClient],
});

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_API_KEY!,
  config: { model: 'gpt-4o-mini' }
});

// Use the agent
const response = await notionAgent.forward(ai, {
  userRequest: 'Summarize my most recently created Notion doc'
});
console.log(response.assistantResponse);
```

### Example Files

Full working examples on GitHub:

- [Local Memory Server (stdio)](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/mcp-client-memory.ts) - Memory-augmented agent using local MCP server
- [Remote HTTP Server (Pipedream/Notion)](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/mcp-client-pipedream.ts) - Notion integration via Pipedream MCP

## Type Reference

```typescript
// Core types
type AxGenIn = Record<string, any>;
type AxGenOut = Record<string, any>;

// Generator
class AxGen<IN, OUT> {
  forward(ai: AxAIService, values: IN, options?: AxProgramForwardOptions): Promise<OUT>;
  streamingForward(ai: AxAIService, values: IN, options?: AxProgramStreamingForwardOptions): AsyncGenerator<{ delta: Partial<OUT> }>;
  setExamples(examples: Array<Partial<IN & OUT>>): void;
  addAssert(fn: (output: OUT) => boolean, message?: string): void;
  addFieldProcessor(field: keyof OUT, fn: (value: any) => any): void;
  addStreamingFieldProcessor(field: keyof OUT, fn: (chunk: string, ctx: any) => void): void;
}

// Agent
class AxAgent<IN, OUT> {
  forward(ai: AxAIService, values: IN, options?: AxAgentOptions): Promise<OUT>;
  streamingForward(ai: AxAIService, values: IN, options?: AxAgentOptions): AsyncGenerator<{ delta: Partial<OUT> }>;
  getFunction(): AxFunction;
}

// Flow
class AxFlow<IN, OUT, TNodes, TState> {
  node(name: string, signature: string | AxSignature): AxFlow;
  execute(nodeName: string, inputMapper: (state: TState) => any): AxFlow;
  map(transformer: (state: TState) => OUT): AxFlow;
  branch(condition: (state: TState) => boolean, ifTrue: FlowBranch, ifFalse: FlowBranch): AxFlow;
  parallel(branches: ParallelBranch[]): AxFlow;
  forward(ai: AxAIService, input: IN): Promise<OUT>;
}
```
