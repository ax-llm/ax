# AWS Bedrock Provider for Ax

Native Amazon Bedrock integration for Ax using the AWS SDK `Converse`,
`ConverseStream`, and Titan embedding APIs. It ships separately so
`@ax-llm/ax` remains free of AWS SDK dependencies.

## Features

- Claude and GPT OSS chat models, plus Titan Embed V2
- Native streaming with cancellation and pre-output regional failover
- Claude tool use and tool-result round trips
- Claude image and document inputs, including inline base64 and `s3://` documents
- Bedrock prompt-cache checkpoints with verified 5-minute and 1-hour TTLs
- Budget and adaptive Claude thinking, including signed reasoning round trips
- Model-specific native structured output and service tiers
- Token, cache-token, request ID, finish-reason, and applied-tier mapping

Capabilities differ by model. Use `ai.getFeatures(model)` before requiring a
feature; unsupported capabilities are deliberately not advertised.

## Installation

```bash
npm install @ax-llm/ax @ax-llm/ax-ai-aws-bedrock
```

The Bedrock package installs `@aws-sdk/client-bedrock-runtime` as its own
runtime dependency. Applications do not need to add the SDK separately.

## Authentication

The client uses the standard AWS SDK credential chain. Configure credentials
through your environment, shared AWS config, workload role, or another SDK-
supported credential source.

## Quick start

```typescript
import {
  AxAIBedrock,
  AxAIBedrockModel,
} from '@ax-llm/ax-ai-aws-bedrock';

const ai = new AxAIBedrock({
  region: process.env.AWS_REGION ?? 'us-east-2',
  fallbackRegions: ['us-west-2', 'us-east-1'],
  config: {
    model: AxAIBedrockModel.ClaudeSonnet5,
    maxTokens: 4096,
  },
});

const response = await ai.chat({
  chatPrompt: [{ role: 'user', content: 'What is Amazon Bedrock?' }],
});

if (response instanceof ReadableStream) {
  throw new Error('Expected a non-streaming response.');
}

console.log(response.results[0]?.content);
```

## Streaming, tools, caching, and thinking

```typescript
const weatherTool = {
  name: 'weather',
  description: 'Read the current weather for a city',
  parameters: {
    type: 'object',
    properties: {
      city: { type: 'string', description: 'City name' },
    },
    required: ['city'],
  },
} as const;

const stream = await ai.chat(
  {
    chatPrompt: [
      { role: 'system', content: 'Use tools for live facts.', cache: true },
      { role: 'user', content: 'What is the weather in Vancouver?' },
    ],
    functions: [weatherTool],
  },
  {
    stream: true,
    contextCache: { ttlSeconds: 3600 },
    thinkingTokenBudget: 'medium',
  }
);
```

Cache checkpoints can be set on system messages, content blocks, messages, and
functions with `cache: true`. Bedrock accepts at most four checkpoints per
request; the provider validates that combined limit before sending.

Claude Sonnet 5 always uses adaptive thinking, so
`thinkingTokenBudget: 'none'` is rejected for that model. Claude Opus 5 allows
adaptive thinking to be disabled.

## Native image and document input

```typescript
const response = await ai.chat({
  chatPrompt: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Compare these inputs.' },
        { type: 'image', image: imageBase64, mimeType: 'image/png' },
        {
          type: 'file',
          fileUri: 's3://my-bucket/policy.pdf',
          filename: 'policy.pdf',
          mimeType: 'application/pdf',
        },
      ],
    },
  ],
});
```

Supported document formats are CSV, DOC, DOCX, HTML, Markdown, PDF, TXT, XLS,
and XLSX. Image formats are GIF, JPEG, PNG, and WebP.

## Models

Current Claude enum members include Sonnet 5, Opus 5, Opus 4.8, Sonnet 4.6,
Haiku 4.5, Opus 4.5, Sonnet 4, and retained 3.x compatibility models. GPT OSS
120B and 20B and Titan Embed V2 remain available.

## Verification

From the repository root:

```bash
npm test --workspace=@ax-llm/ax-ai-aws-bedrock
```
