# AWS Bedrock Provider for AX

Production-ready AWS Bedrock integration for AX library. Supports Claude, GPT OSS, and Titan Embed models.

## Features

- **Claude models**: Sonnet 3.5, 3.7, 4.0
- **GPT OSS models**: 120B, 20B
- **Embeddings**: Titan Embed V2
- Regional failover (separate configs for Claude and GPT)
- Token usage tracking
- Works with AX signatures, flows, and optimizers

## Installation

```bash
npm install @ax-llm/ax-ai-aws-bedrock @ax-llm/ax @aws-sdk/client-bedrock-runtime
```

## Quick Start

```typescript
import { AxAIBedrock, AxAIBedrockModel } from '@ax-llm/ax-ai-aws-bedrock';

const ai = new AxAIBedrock({
  region: 'us-east-2',
  fallbackRegions: ['us-west-2', 'us-east-1'],
  config: {
    model: AxAIBedrockModel.ClaudeSonnet4,
    temperature: 0.7,
    maxTokens: 4096,
  },
});

const response = await ai.chat({
  chatPrompt: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'What is AWS Bedrock?' },
  ],
});
```

## With AX Signatures

```typescript
import { AxSignature, AxGen } from '@ax-llm/ax';

const ai = new AxAIBedrock({ config: { model: AxAIBedrockModel.ClaudeSonnet4 } });
const summarize = new AxSignature('document: string -> summary: string');
const program = new AxGen(summarize, { ai });

const result = await program.forward({ document: 'Your text...' });
```

## Available Models

```typescript
// Claude
AxAIBedrockModel.ClaudeSonnet4; // us.anthropic.claude-sonnet-4-20250514-v1:0
AxAIBedrockModel.Claude37Sonnet; // anthropic.claude-3-7-sonnet-20250219-v1:0
AxAIBedrockModel.Claude35Sonnet; // anthropic.claude-3-5-sonnet-20240620-v1:0

// GPT OSS
AxAIBedrockModel.GptOss120B; // openai.gpt-oss-120b-1:0
AxAIBedrockModel.GptOss20B; // openai.gpt-oss-20b-1:0

// Embeddings
AxAIBedrockEmbedModel.TitanEmbedV2; // amazon.titan-embed-text-v2:0
```

## Testing

```bash
bun test packages/api/src/agent/ax-main/src/ax/ai/bedrock/api.test.ts
```

See `examples.ts` and `QUICKSTART.md` for more examples.
