---
title: "Examples Guide"
description: "Comprehensive examples showcasing Ax framework capabilities"
---

# Ax Examples Guide

A comprehensive collection of examples showcasing Ax framework capabilities, from basic signatures to production-ready patterns.

## Table of Contents

- [Getting Started](#getting-started)
- [Core Concepts](#core-concepts)
- [Advanced Features](#advanced-features)
- [Production Patterns](#production-patterns)
- [Optimization & Training](#optimization--training)
- [Multi-Modal & Vision](#multi-modal--vision)
- [Agent Systems](#agent-systems)
- [Workflow Orchestration](#workflow-orchestration)

## Getting Started

### 1. Basic Signature - Email Classification

The simplest way to start with Ax - define input → output, get type-safe results.

```typescript
import { ai, ax } from '@ax-llm/ax';

// Define your signature
const classifier = ax(
  'email:string -> category:class "spam, important, normal" "Email category"'
);

// Choose your LLM
const llm = ai({ 
  name: 'openai', 
  apiKey: process.env.OPENAI_APIKEY! 
});

// Get results
const result = await classifier.forward(llm, {
  email: "URGENT: You've won $1,000,000! Click here now!"
});

console.log(result.category); // "spam" - Type-safe!
```

**Key Concepts:**
- Signatures define the contract: `input -> output`
- `class` type ensures output is one of the specified values
- Full TypeScript type inference

### 2. Structured Extraction

Extract multiple structured fields from unstructured text in one call.

```typescript
import { ax, ai } from '@ax-llm/ax';

const extractor = ax(`
  customerEmail:string, currentDate:datetime -> 
  subject:string "Email subject",
  priority:class "high, normal, low",
  sentiment:class "positive, negative, neutral",
  ticketNumber?:number "Optional ticket number",
  nextSteps:string[] "Action items",
  estimatedResponseTime:string
`);

const result = await extractor.forward(ai({ name: 'openai' }), {
  customerEmail: `
    Subject: Order #12345 hasn't arrived
    
    I ordered 2 weeks ago and still haven't received my package.
    This is unacceptable! I need this resolved immediately or I want a refund.
    The tracking shows it's been stuck for days.
  `,
  currentDate: new Date()
});

console.log(result);
// {
//   subject: "Order #12345 hasn't arrived",
//   priority: "high",
//   sentiment: "negative",
//   ticketNumber: 12345,
//   nextSteps: ["Check tracking status", "Contact shipping carrier", "Offer refund or replacement"],
//   estimatedResponseTime: "Within 24 hours"
// }
```

### 3. Adding Validation with Assertions

Ensure outputs meet your business rules with assertions. Assertions provide multiple ways to signal failures:

```typescript
import { ax, ai } from '@ax-llm/ax';

const gen = ax('startNumber:number -> next10Numbers:number[], summary:string');

// Method 1: Return false with a fallback message
gen.addAssert(
  ({ next10Numbers }) => next10Numbers?.length === 10,
  'Must generate exactly 10 numbers'
);

// Method 2: Return a custom error string (recommended)
gen.addAssert(({ next10Numbers }) => {
  if (!next10Numbers) return undefined; // Skip validation if undefined
  if (next10Numbers.length !== 10) {
    return `Generated ${next10Numbers.length} numbers, expected exactly 10`;
  }
  return true; // Pass validation
});

// Method 3: Throw custom errors for immediate failure
gen.addAssert(({ next10Numbers }) => {
  if (next10Numbers?.some(n => n <= 0)) {
    throw new Error(`Invalid numbers found: ${next10Numbers.filter(n => n <= 0)}`);
  }
  return true;
});

// Method 4: Conditional validation with undefined return
gen.addAssert(({ summary }) => {
  if (!summary) return undefined; // Skip if summary not provided
  return summary.length >= 20; // Only validate if present
}, 'Summary must be at least 20 characters when provided');

// Ax will automatically retry if assertions fail (up to maxRetries)
const result = await gen.forward(ai({ name: 'openai' }), {
  startNumber: 1
});
```

**Assertion Return Values:**
- `true`: Assertion passes, continue generation
- `false`: Assertion fails, use provided message parameter
- `string`: Assertion fails, use the returned string as error message
- `undefined`: Skip this assertion (useful for conditional validation)
- `throw Error()`: Immediate failure with custom error (no retries)

**Streaming Assertions:**

```typescript
const streamingGen = ax('topic:string -> article:string, title:string');

// Validate streaming content as it's generated
streamingGen.addStreamingAssert('article', (content, done) => {
  // Only validate complete content
  if (!done) return undefined;

  if (content.length < 100) {
    return 'Article must be at least 100 characters long';
  }

  return true;
});

// Stream with validation
for await (const chunk of streamingGen.streamingForward(ai({ name: 'openai' }), {
  topic: 'TypeScript best practices'
})) {
  console.log(chunk.article || chunk.title || '');
}
```

### 3.5. Field Validation & Constraints (New!)

Ensure data quality with built-in Zod-like validation constraints. These run automatically on both inputs and outputs.

#### Data Quality with Built-in Validators

```typescript
import { ax, f, ai } from '@ax-llm/ax';

const userRegistration = f()
  .input('formData', f.string('Raw registration form data'))
  .output('user', f.object({
    username: f.string('Username').min(3).max(20),
    email: f.string('Email address').email(),
    age: f.number('User age').min(18).max(120),
    password: f.string('Password').min(8).regex('^(?=.*[A-Za-z])(?=.*\\d)'),
    bio: f.string('User biography').max(500).optional(),
    website: f.string('Personal website').url().optional(),
    tags: f.string('Interest tag').min(2).max(30).array()
  }))
  .build();

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_APIKEY! });
const generator = ax(userRegistration);

const result = await generator.forward(llm, {
  formData: `
    Name: johndoe
    Email: john@example.com
    Age: 25
    Password: secure123
    Bio: Software developer passionate about TypeScript and AI
    Website: https://johndoe.dev
    Tags: typescript, ai, web development
  `
});

console.log(result.user);
// {
//   username: "johndoe",
//   email: "john@example.com",
//   age: 25,
//   password: "secure123",
//   bio: "Software developer passionate about TypeScript and AI",
//   website: "https://johndoe.dev",
//   tags: ["typescript", "ai", "web development"]
// }

// All constraints are validated:
// ✅ username: 3-20 characters
// ✅ email: valid email format
// ✅ age: between 18-120
// ✅ password: min 8 chars with letter and number
// ✅ website: valid URL format
// ✅ tags: each 2-30 characters
```

**Available Validators:**
- `.min(n)` / `.max(n)` - String length or number range
- `.email()` - Email format (or use `f.email()`)
- `.url()` - URL format (or use `f.url()`)
- `.date()` - Date format (or use `f.date()`)
- `.datetime()` - DateTime format (or use `f.datetime()`)
- `.regex(pattern, description)` - Custom regex pattern
- `.optional()` - Make field optional

**Note:** For email, url, date, and datetime, you can use either the validator syntax (`f.string().email()`) or the dedicated type syntax (`f.email()`). Both work consistently everywhere!

#### Contact Form with Regex Patterns

```typescript
import { ax, f } from '@ax-llm/ax';

const contactFormParser = f()
  .input('formSubmission', f.string('Raw form data'))
  .output('contact', f.object({
    fullName: f.string('Full name').min(2).max(100),
    email: f.string('Email address').email(),
    phone: f.string('Phone number').regex('^\\+?[1-9]\\d{1,14}$'),
    subject: f.string('Subject line').min(5).max(200),
    message: f.string('Message content').min(20).max(2000),
    urgency: f.string('Urgency level').optional()
  }))
  .build();

const result = await ax(contactFormParser).forward(llm, {
  formSubmission: `
    Name: Jane Smith
    Email: jane.smith@company.com
    Phone: +1234567890
    Subject: Product inquiry about Enterprise plan
    Message: I'm interested in learning more about your Enterprise plan for our team of 50 developers. Could you provide pricing and feature details?
    Urgency: High
  `
});

// Validation ensures:
// ✅ Phone matches international format
// ✅ Email is properly formatted
// ✅ Message has sufficient detail (20+ chars)
// ✅ Subject is descriptive (5-200 chars)
```

#### E-Commerce Product Validation

```typescript
import { ax, f } from '@ax-llm/ax';

const productExtractor = f()
  .input('productPage', f.string('Product page HTML'))
  .output('product', f.object({
    name: f.string('Product name').min(1).max(200),
    price: f.number('Price in USD').min(0),
    specifications: f.object({
      dimensions: f.object({
        width: f.number('Width in cm').min(0),
        height: f.number('Height in cm').min(0),
        depth: f.number('Depth in cm').min(0)
      }),
      weight: f.number('Weight in kg').min(0),
      materials: f.string('Material name').min(1).array()
    }),
    availability: f.object({
      inStock: f.boolean('Stock status'),
      quantity: f.number('Available quantity').min(0),
      restockDate: f.string('Restock date').optional()
    }),
    images: f.object({
      url: f.string('Image URL').url(),
      alt: f.string('Alt text').min(1).max(100)
    }).array(),
    reviews: f.object({
      rating: f.number('Rating').min(1).max(5),
      comment: f.string('Review text').min(10).max(1000),
      verified: f.boolean('Verified purchase')
    }).array()
  }))
  .build();

const result = await ax(productExtractor).forward(llm, {
  productPage: '<html>...</html>'  // Real product page HTML
});

// Deep validation ensures:
// ✅ All dimensions are non-negative numbers
// ✅ Rating is between 1-5
// ✅ Image URLs are valid
// ✅ Review comments have meaningful length
// ✅ Nested object structure is correct
```

**Key Features:**
- **Automatic Input Validation**: Validates before sending to LLM
- **Automatic Output Validation**: Validates LLM responses
- **Auto-Retry**: ValidationError triggers retry with corrections
- **Streaming Support**: Incremental validation during streaming
- **Nested Validation**: Works recursively through objects and arrays
- **TypeScript Safety**: Full compile-time + runtime validation

## Core Concepts

### 4. Function Calling (ReAct Pattern)

Let your AI use tools to answer questions - the ReAct (Reasoning + Acting) pattern.

```typescript
import { ax, ai, type AxFunction } from '@ax-llm/ax';

// Define available functions
const functions: AxFunction[] = [
  {
    name: 'getCurrentWeather',
    description: 'Get current weather for a location',
    parameters: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City name' },
        units: { type: 'string', enum: ['celsius', 'fahrenheit'] }
      },
      required: ['location']
    },
    func: async ({ location, units }) => {
      // Real API call would go here
      return { temp: 72, condition: 'sunny', location };
    }
  },
  {
    name: 'searchNews',
    description: 'Search for recent news',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', default: 5 }
      },
      required: ['query']
    },
    func: async ({ query, limit }) => {
      return [`Breaking: ${query} news item 1`, `Update: ${query} item 2`];
    }
  }
];

// Create signature with functions
const assistant = ax(
  'question:string -> answer:string "Detailed answer using available tools"',
  { functions }
);

const result = await assistant.forward(
  ai({ name: 'openai' }), 
  { question: "What's the weather like in Tokyo and any news about it?" }
);

// AI will automatically call both functions and combine results
console.log(result.answer);
// "The current weather in Tokyo is 72°F and sunny. Recent news about Tokyo includes..."
```

### 5. Streaming Responses

Stream responses for real-time user feedback.

```typescript
import { ax, ai } from '@ax-llm/ax';

const gen = ax('topic:string -> article:string "500 word article"');

// Enable streaming
const stream = await gen.streamingForward(
  ai({ name: 'openai' }),
  { topic: 'The future of TypeScript' }
);

// Process chunks as they arrive
for await (const chunk of stream) {
  if (chunk.article) {
    process.stdout.write(chunk.article); // Real-time output
  }
}
```

### 6. Multi-Step Reasoning with Examples

Improve accuracy by providing examples - few-shot learning made simple.

```typescript
import { AxGen, ai } from '@ax-llm/ax';

const analyzer = new AxGen<
  { code: string },
  { hasVulnerability: boolean; type?: string; severity?: string; suggestion?: string }
>('code:string -> hasVulnerability:boolean, type?:string, severity?:string, suggestion?:string');

// Add examples to guide the AI
analyzer.setExamples([
  {
    code: 'const password = "admin123"',
    hasVulnerability: true,
    type: 'Hardcoded Credentials',
    severity: 'critical',
    suggestion: 'Use environment variables for sensitive data'
  },
  {
    code: 'const add = (a: number, b: number) => a + b',
    hasVulnerability: false
  }
]);

const result = await analyzer.forward(
  ai({ name: 'openai' }),
  { code: 'eval(userInput)' }
);
// { hasVulnerability: true, type: "Code Injection", severity: "critical", ... }
```

## Advanced Features

### 7. Multi-Modal Processing

Process images and text together seamlessly.

```typescript
import { ax, ai, image } from '@ax-llm/ax';

const analyzer = ax(`
  image:image "Product photo",
  question:string ->
  description:string,
  mainColors:string[],
  category:class "electronics, clothing, food, other",
  estimatedPrice:string
`);

const result = await analyzer.forward(
  ai({ name: 'openai', config: { model: 'gpt-4o' } }),
  {
    image: image('./product.jpg'),
    question: 'What product is this and what can you tell me about it?'
  }
);
```

### 8. Smart Document Processing with Chain of Thought

Process complex documents with automatic reasoning steps.

```typescript
import { ax, ai } from '@ax-llm/ax';

const processor = ax(`
  document:string "Full document text",
  instructions:string ->
  thinking:string "Step-by-step analysis",
  summary:string "Executive summary",
  keyInsights:string[] "Main takeaways",
  risks:string[] "Identified risks",
  opportunities:string[] "Identified opportunities",
  recommendedActions:string[] "Concrete next steps",
  confidence:number "0-100 confidence score"
`);

const result = await processor.forward(
  ai({ name: 'anthropic', config: { model: 'claude-3-5-sonnet' } }),
  {
    document: businessPlan,
    instructions: "Analyze this business plan for investment potential"
  }
);

// Access the reasoning process
console.log('Analysis:', result.thinking);
console.log('Summary:', result.summary);
console.log('Confidence:', result.confidence);
```

## Production Patterns

### 9. Customer Support Agent

Complete customer support system with routing, prioritization, and response generation.

```typescript
import { ax, ai } from '@ax-llm/ax';

const supportAgent = ax(`
  customerMessage:string,
  customerHistory?:string "Previous interactions",
  knowledgeBase?:string "Relevant KB articles" ->
  intent:class "question, complaint, feedback, request",
  department:class "billing, technical, sales, general",
  priority:class "urgent, high, normal, low",
  sentiment:number "0-10 scale",
  suggestedResponse:string,
  internalNotes:string "For support team",
  requiresHumanReview:boolean,
  tags:string[]
`);

// Add validation rules
supportAgent.addAssert(
  ({ priority, sentiment }) => 
    !(priority === 'low' && sentiment !== undefined && sentiment < 3),
  'Low sentiment should not be low priority'
);

const result = await supportAgent.forward(
  ai({ name: 'openai' }),
  {
    customerMessage: "I've been charged twice for my subscription and need a refund immediately!",
    customerHistory: "Premium customer since 2020, previous billing issue in March"
  }
);

console.log(`Route to: ${result.department} (Priority: ${result.priority})`);
console.log(`Response: ${result.suggestedResponse}`);
```

### 10. Restaurant Recommendation System

Multi-criteria recommendation with function calling.

```typescript
import { ax, ai, type AxFunction } from '@ax-llm/ax';

const searchRestaurants: AxFunction = {
  name: 'searchRestaurants',
  description: 'Search restaurants by criteria',
  parameters: {
    type: 'object',
    properties: {
      cuisine: { type: 'string' },
      priceRange: { type: 'string', enum: ['$', '$$', '$$$', '$$$$'] },
      location: { type: 'string' },
      features: { 
        type: 'array', 
        items: { type: 'string' },
        description: 'outdoor seating, delivery, etc'
      }
    }
  },
  func: async (params) => {
    // Database query would go here
    return mockRestaurantData.filter(r => 
      r.cuisine === params.cuisine && 
      r.priceRange === params.priceRange
    );
  }
};

const recommender = ax(`
  preferences:string "User's dining preferences",
  occasion:string,
  groupSize:number,
  location:string ->
  thinking:string "Analysis of preferences",
  recommendations:object[] "Top 3 restaurants with reasons",
  bestMatch:object "Single best recommendation",
  alternativeOptions:string "Other cuisines to consider"
`, { 
  functions: [searchRestaurants, getWeather, checkAvailability] 
});

const result = await recommender.forward(
  ai({ name: 'openai' }),
  {
    preferences: "I love spicy food and outdoor dining",
    occasion: "anniversary dinner",
    groupSize: 2,
    location: "San Francisco"
  }
);
```

## Optimization & Training

### 11. Automatic Prompt Optimization

Use Bootstrap Few-Shot optimization to improve accuracy automatically.

```typescript
import { ax, ai, AxBootstrapFewShot, type AxMetricFn } from '@ax-llm/ax';

// Define your task
const classifier = ax(
  'email:string -> category:class "spam, important, normal", confidence:number'
);

// Provide training examples
const trainingData = [
  { email: "Meeting at 3pm", category: "normal", confidence: 0.9 },
  { email: "WINNER! Claim prize!", category: "spam", confidence: 0.95 },
  { email: "Server is down", category: "important", confidence: 0.85 },
  // ... more examples
];

// Define success metric
const metric: AxMetricFn = ({ prediction, example }) => {
  const correct = prediction.category === example.category;
  const confidentAndCorrect = correct && prediction.confidence > 0.8;
  return confidentAndCorrect ? 1 : correct ? 0.5 : 0;
};

// Run optimization
const optimizer = new AxBootstrapFewShot({
  studentAI: ai({ name: 'openai' }),
  teacherAI: ai({ name: 'anthropic' }), // Optional: use stronger model as teacher
  metric,
  options: {
    maxRounds: 5,
    maxDemos: 3,
    maxExamples: 100
  }
});

const optimized = await optimizer.compile(classifier, trainingData);
console.log(`Improved accuracy from 65% to ${optimized.bestScore * 100}%`);

// Use optimized program
const result = await optimized.program.forward(ai({ name: 'openai' }), {
  email: "System maintenance tonight"
});
```

## Agent Systems

### 12. Multi-Agent Collaboration

Build systems where specialized agents work together.

```typescript
import { AxAgent, ai } from '@ax-llm/ax';

// Specialized researcher agent
const researcher = new AxAgent({
  name: 'Researcher',
  description: 'Expert at finding and analyzing information',
  signature: 'question:string -> research:string "Detailed findings", sources:string[]'
});

// Specialized writer agent  
const writer = new AxAgent({
  name: 'Writer',
  description: 'Expert at creating engaging content',
  signature: 'research:string, tone:string -> article:string, title:string'
});

// Specialized editor agent
const editor = new AxAgent({
  name: 'Editor',
  description: 'Expert at improving clarity and correctness',
  signature: 'article:string -> editedArticle:string, changes:string[]'
});

// Coordinator agent that orchestrates others
const coordinator = new AxAgent({
  name: 'Content Creator',
  description: 'Creates high-quality articles using specialized agents',
  signature: 'topic:string, style:string -> finalArticle:string, metadata:object',
  agents: [researcher, writer, editor]
});

// The coordinator will automatically delegate to the right agents
const result = await coordinator.forward(
  ai({ name: 'openai' }),
  {
    topic: 'The future of TypeScript',
    style: 'technical but accessible'
  }
);

console.log(result.finalArticle); // Fully researched, written, and edited article
```

### 13. Agent with Memory and Tools

Build stateful agents that remember context and use tools.

```typescript
import { AxAgent, AxMemory, ai, type AxFunction } from '@ax-llm/ax';

// Create memory store
const memory = new AxMemory();

// Define agent tools
const tools: AxFunction[] = [
  {
    name: 'saveNote',
    description: 'Save important information for later',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string' },
        content: { type: 'string' }
      }
    },
    func: async ({ category, content }) => {
      await memory.add(category, content);
      return 'Saved to memory';
    }
  },
  {
    name: 'recall',
    description: 'Recall previously saved information',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string' },
        query: { type: 'string' }
      }
    },
    func: async ({ category, query }) => {
      return await memory.search(category, query);
    }
  }
];

const assistant = new AxAgent({
  name: 'Personal Assistant',
  description: 'Helps manage tasks and remember important information',
  signature: 'message:string, userId:string -> response:string, actionsTaken:string[]',
  functions: tools,
  memory
});

// First interaction
await assistant.forward(ai({ name: 'openai' }), {
  message: "Remember that my favorite color is blue",
  userId: "user123"
});

// Later interaction - agent remembers
const result = await assistant.forward(ai({ name: 'openai' }), {
  message: "What's my favorite color?",
  userId: "user123"  
});
// "Your favorite color is blue"
```

## Workflow Orchestration

### 14. AxFlow - Complex Pipeline

Build sophisticated data processing pipelines with AxFlow.

```typescript
import { AxFlow, AxFlow, ai } from '@ax-llm/ax';

// Create a content moderation pipeline
const pipeline = new AxFlow()
  // Step 1: Analyze content
  .addNode('analyzer', ax(`
    content:string ->
    hasPII:boolean "Contains personal information",
    hasProfanity:boolean,
    toxicityScore:number "0-100",
    topics:string[]
  `))
  
  // Step 2: Redact sensitive info (only if needed)
  .addNode('redactor', ax(`
    content:string,
    hasPII:boolean ->
    redactedContent:string,
    redactedItems:string[]
  `))
  
  // Step 3: Generate moderation decision
  .addNode('moderator', ax(`
    content:string,
    toxicityScore:number,
    hasProfanity:boolean ->
    decision:class "approve, flag, reject",
    reason:string,
    suggestedAction:string
  `))
  
  // Define the flow
  .flow(({ content }) => ({
    analyzer: { content },
    redactor: { 
      content, 
      hasPII: '{{analyzer.hasPII}}' 
    },
    moderator: {
      content: '{{redactor.redactedContent}}',
      toxicityScore: '{{analyzer.toxicityScore}}',
      hasProfanity: '{{analyzer.hasProfanity}}'
    }
  }));

const result = await pipeline.run(
  ai({ name: 'openai' }),
  { content: "John Smith (SSN: 123-45-6789) posted offensive content" }
);

console.log(result.moderator.decision); // "reject"
console.log(result.redactor.redactedItems); // ["SSN: XXX-XX-XXXX"]
```

### 15. Parallel Processing with Map-Reduce

Process multiple items in parallel and aggregate results.

```typescript
import { AxFlow, ax, ai } from '@ax-llm/ax';

const flow = new AxFlow()
  // Map: Process each item in parallel
  .map('processor', ax(`
    item:object ->
    processed:object,
    quality:number,
    issues:string[]
  `))
  
  // Reduce: Aggregate all results
  .reduce('aggregator', ax(`
    results:object[] ->
    summary:string,
    totalQuality:number,
    allIssues:string[],
    recommendations:string[]
  `));

const items = [
  { id: 1, data: 'Item 1 data' },
  { id: 2, data: 'Item 2 data' },
  { id: 3, data: 'Item 3 data' }
];

const result = await flow.run(
  ai({ name: 'openai' }),
  { items }
);

console.log(`Processed ${items.length} items`);
console.log(`Average quality: ${result.totalQuality / items.length}`);
```

## Running Examples

All examples are in the `src/examples/` directory. To run any example:

```bash
# Set your API key
export OPENAI_APIKEY=your-key-here
# Or for other providers:
export ANTHROPIC_APIKEY=your-key
export GOOGLE_APIKEY=your-key

# Run an example
npm run tsx ./src/examples/summarize.ts
```

## Best Practices

1. **Start Simple**: Begin with basic signatures, add complexity as needed
2. **Use Types**: Leverage TypeScript's type system for safety
3. **Add Assertions**: Validate outputs to ensure quality
4. **Provide Examples**: Few-shot examples dramatically improve accuracy
5. **Optimize When Needed**: Use BootstrapFewShot for production accuracy
6. **Handle Errors**: Always wrap in try-catch for production
7. **Stream for UX**: Use streaming for better user experience
8. **Monitor Performance**: Use built-in telemetry for observability

## Next Steps

- [Read the DSPy Concepts](https://github.com/ax-llm/ax/blob/main/../DSPY.md) to understand the theory
- [Explore the API Reference](https://github.com/ax-llm/ax/blob/main/../API.md) for detailed documentation
- [Join our Discord](https://discord.gg/DSHg3dU7dW) for help and discussions
- [Star us on GitHub](https://github.com/ax-llm/ax) if you find Ax useful!