---
title: "Quick Start"
description: "Get from zero to your first AI application in 5 minutes"
---

# Quick Start Guide

This guide will get you from zero to your first AI application in 5 minutes.

## Prerequisites

- Node.js 20 or higher
- An API key from OpenAI, Anthropic, or Google (we'll use OpenAI in this guide)

## Installation

```bash
npm install @ax-llm/ax
```

### Additional Packages

```bash
# AWS Bedrock provider (Claude, GPT, Titan on AWS)
npm install @ax-llm/ax-ai-aws-bedrock

# Vercel AI SDK v5 integration
npm install @ax-llm/ax-ai-sdk-provider

# Tools: MCP stdio transport, JS interpreter
npm install @ax-llm/ax-tools
```

See the [AI Providers Guide](/ai/) for detailed documentation on each package.

## Step 1: Set Up Your API Key

Create a `.env` file in your project root:

```bash
OPENAI_APIKEY=your-api-key-here
```

Or export it in your terminal:

```bash
export OPENAI_APIKEY=your-api-key-here
```

## Step 2: Your First AI Program

Create a file called `hello-ai.ts`:

```typescript
import { ai, ax } from "@ax-llm/ax";

// Initialize your AI provider
const llm = ai({ 
  name: "openai", 
  apiKey: process.env.OPENAI_APIKEY! 
});

// Create a simple classifier
const sentimentAnalyzer = ax(
  'reviewText:string -> sentiment:class "positive, negative, neutral"'
);

// Use it!
async function analyze() {
  const result = await sentimentAnalyzer.forward(llm, {
    reviewText: "This product exceeded all my expectations!"
  });
  
  console.log(`Sentiment: ${result.sentiment}`);
}

analyze();
```

## Step 3: Run Your Program

```bash
npx tsx hello-ai.ts
```

You should see:
```
Sentiment: positive
```

## What Just Happened?

1. **No prompt engineering** - You didn't write any prompts, just described what you wanted
2. **Type safety** - TypeScript knows that `result.sentiment` is one of your three classes
3. **Automatic optimization** - The framework generated an optimal prompt for you
4. **Provider agnostic** - This same code works with Claude, Gemini, or any other LLM

## Next: Add Streaming

Want to see results as they generate? Add one parameter:

```typescript
const result = await sentimentAnalyzer.forward(
  llm, 
  { reviewText: "Great product!" },
  { stream: true }  // ← Enable streaming
);
```

## Next: Multi-Modal (Images)

Work with images just as easily:

```typescript
import fs from "fs";

const imageAnalyzer = ax(
  'photo:image, question:string -> answer:string'
);

const imageData = fs.readFileSync("photo.jpg").toString("base64");

const result = await imageAnalyzer.forward(llm, {
  photo: { mimeType: "image/jpeg", data: imageData },
  question: "What's in this image?"
});
```

## Next: Complex Workflows

Build multi-step processes:

```typescript
const documentProcessor = ax(`
  documentText:string -> 
  summary:string "2-3 sentences",
  keyPoints:string[] "main points",
  sentiment:class "positive, negative, neutral"
`);

const result = await documentProcessor.forward(llm, {
  documentText: "Your long document here..."
});

console.log(`Summary: ${result.summary}`);
console.log(`Key Points: ${result.keyPoints.join(", ")}`);
console.log(`Sentiment: ${result.sentiment}`);
```

## Next: Add Validation

Ensure data quality with built-in validators:

```typescript
import { f, ax } from "@ax-llm/ax";

const contactForm = f()
  .input("formData", f.string())
  .output("contact", f.object({
    name: f.string().min(2).max(100),
    email: f.string().email(),
    age: f.number().min(18).max(120),
    website: f.string().url().optional(),
    message: f.string().min(10).max(500)
  }))
  .build();

const generator = ax(contactForm);
const result = await generator.forward(llm, {
  formData: "Name: John Doe, Email: john@example.com, Age: 30..."
});

// All fields are automatically validated:
// - name: 2-100 characters
// - email: valid email format
// - age: between 18-120
// - website: valid URL if provided
// - message: 10-500 characters
```

**Available Constraints:**
- `.min(n)` / `.max(n)` - String length or number range
- `.email()` - Email format validation (or use `f.email()`)
- `.url()` - URL format validation (or use `f.url()`)
- `.date()` - Date format validation (or use `f.date()`)
- `.datetime()` - Datetime format validation (or use `f.datetime()`)
- `.regex(pattern, description)` - Custom regex pattern with human-readable description
- `.optional()` - Make field optional

**Note:** For email, url, date, and datetime, you can use either the validator syntax (`f.string().email()`) or the dedicated type syntax (`f.email()`). Both work consistently in all contexts!

Validation runs automatically:
- ✅ **Before LLM calls** - Input validation ensures clean data
- ✅ **After LLM responses** - Output validation with auto-retry on errors
- ✅ **During streaming** - Incremental validation as fields complete

## Using Different Providers

### OpenAI
```typescript
const llm = ai({ 
  name: "openai", 
  apiKey: process.env.OPENAI_APIKEY!,
  config: { model: "gpt-4o" }  // Optional: specify model
});
```

### Anthropic Claude
```typescript
const llm = ai({ 
  name: "anthropic", 
  apiKey: process.env.ANTHROPIC_APIKEY!,
  config: { model: "claude-3-5-sonnet-20241022" }
});
```

### Google Gemini
```typescript
const llm = ai({ 
  name: "google-gemini", 
  apiKey: process.env.GOOGLE_APIKEY!,
  config: { model: "gemini-1.5-pro" }
});
```

### Local Ollama
```typescript
const llm = ai({ 
  name: "ollama",
  config: { model: "llama3.2" }
});
```

## Field Types Reference

| Type | Example | Description |
|------|---------|-------------|
| `string` | `name:string` | Text input/output |
| `number` | `score:number` | Numeric values |
| `boolean` | `isValid:boolean` | True/false |
| `class` | `category:class "a,b,c"` | Enumeration |
| `string[]` | `tags:string[]` | Array of strings |
| `json` | `data:json` | Any JSON object |
| `image` | `photo:image` | Image input |
| `audio` | `recording:audio` | Audio input |
| `date` | `dueDate:date` | Date value |
| `?` | `notes?:string` | Optional field |

## Common Patterns

### Classification
```typescript
const classifier = ax(
  'text:string -> category:class "option1, option2, option3"'
);
```

### Extraction
```typescript
const extractor = ax(
  'document:string -> names:string[], dates:date[], amounts:number[]'
);
```

### Question Answering
```typescript
const qa = ax(
  'context:string, question:string -> answer:string'
);
```

### Translation
```typescript
const translator = ax(
  'text:string, targetLanguage:string -> translation:string'
);
```

## Error Handling

```typescript
try {
  const result = await gen.forward(llm, input);
} catch (error) {
  console.error("Generation failed:", error);
}
```

## Debug Mode

See what's happening under the hood:

```typescript
const llm = ai({ 
  name: "openai", 
  apiKey: process.env.OPENAI_APIKEY!,
  options: { debug: true }  // Enable debug logging
});
```

## What's Next?

Now that you have the basics:

1. **Explore Examples** - Check out the [examples directory](https://github.com/ax-llm/ax/blob/main/src/examples/) for real-world patterns
2. **Learn DSPy Concepts** - Understand the [revolutionary approach](/dspy/)
3. **Build Workflows** - Create complex systems with [AxFlow](/axflow/)
4. **Optimize Performance** - Make your programs smarter with [optimization](/optimize/)
5. **Add Observability** - Monitor production apps with [telemetry](/telemetry/)

## Need Help?

- 💬 [Join our Discord](https://discord.gg/DSHg3dU7dW)
- 📖 [Read the docs](https://github.com/ax-llm/ax)
- 🐦 [Follow on Twitter](https://twitter.com/dosco)

## 🔗 Integration with Vercel AI SDK v5

Ax provides seamless integration with the Vercel AI SDK through `@ax-llm/ax-ai-sdk-provider`:

### Installation

```bash
npm install @ax-llm/ax-ai-sdk-provider
```

### Basic Usage

```typescript
import { ai } from "@ax-llm/ax";
import { AxAIProvider } from "@ax-llm/ax-ai-sdk-provider";
import { streamUI } from "ai/rsc";

// Create Ax AI instance
const axAI = ai({
  name: "openai",
  apiKey: process.env.OPENAI_APIKEY!
});

// Create AI SDK v5 compatible provider
const model = new AxAIProvider(axAI);

// Use with AI SDK functions
const result = await streamUI({
  model,
  messages: [
    { role: "user", content: "Hello!" }
  ],
  text: ({ content }) => content,
});
```

### Features

- ✅ **AI SDK v5 Compatible**: Implements `LanguageModelV2` specification
- ✅ **Full Tool Support**: Function calling with proper serialization
- ✅ **Streaming**: Enhanced streaming with lifecycle events
- ✅ **Multi-modal**: Text, images, and file inputs
- ✅ **Type Safety**: Full TypeScript support

> **Note**: This allows you to use Ax's powerful AI provider ecosystem with any AI SDK v5 application, giving you access to 15+ LLM providers through a single interface.

---

## 🔗 AWS Bedrock Provider

Use Claude, GPT, and Titan models on AWS with `@ax-llm/ax-ai-aws-bedrock`:

### Installation

```bash
npm install @ax-llm/ax-ai-aws-bedrock
```

### Basic Usage

```typescript
import { AxAIBedrock, AxAIBedrockModel } from "@ax-llm/ax-ai-aws-bedrock";
import { ax } from "@ax-llm/ax";

const ai = new AxAIBedrock({
  region: "us-east-2",
  config: { model: AxAIBedrockModel.ClaudeSonnet4 }
});

const generator = ax("question:string -> answer:string");
const result = await generator.forward(ai, {
  question: "What is AWS Bedrock?"
});

console.log(result.answer);
```

### Features

- ✅ **Claude, GPT, Titan**: All major Bedrock models supported
- ✅ **Regional Failover**: Automatic failover across AWS regions
- ✅ **Embeddings**: Titan Embed V2 for vector embeddings
- ✅ **AWS Auth**: Uses standard AWS credential chain

---

## 🔗 Ax Tools Package

Additional tools for MCP and code execution with `@ax-llm/ax-tools`:

### Installation

```bash
npm install @ax-llm/ax-tools
```

### MCP Stdio Transport

```typescript
import { AxMCPClient } from "@ax-llm/ax";
import { axCreateMCPStdioTransport } from "@ax-llm/ax-tools";

const transport = axCreateMCPStdioTransport({
  command: "npx",
  args: ["-y", "@anthropic/mcp-server-filesystem"]
});

const client = new AxMCPClient(transport);
await client.init();
const tools = await client.getTools();
```

### JavaScript Interpreter

```typescript
import { ai, ax } from "@ax-llm/ax";
import { AxJSInterpreter, AxJSInterpreterPermission } from "@ax-llm/ax-tools";

const interpreter = new AxJSInterpreter({
  permissions: [AxJSInterpreterPermission.CRYPTO]
});

const llm = ai({ name: "openai", apiKey: process.env.OPENAI_APIKEY! });

const codeRunner = ax("task:string -> result:string", {
  functions: [interpreter.toFunction()]
});
```

---

Remember: **You're not writing prompts, you're declaring capabilities.** Let the framework handle the complexity while you focus on building.