## Vercel AI SDK Integration

Install the ax provider package

```shell
npm i @ax-llm/ax-ai-sdk-provider
```

### AI SDK v7 Compatibility

This provider is compatible with **AI SDK v7** and implements the `LanguageModelV3` specification. It supports:

- **Text Generation**: Standard text completion and chat functionality
- **Tool Calling**: Function calls with proper serialization/deserialization
- **Streaming**: Streaming lifecycle events (`stream-start`, `text-start`, `text-delta`, `text-end`, `finish`)
- **Multi-modal**: Support for text and file inputs (images, documents)
- **Token Usage**: AI SDK v7 usage shape with nested `inputTokens` and `outputTokens`

AI SDK v7 requires Node.js 22+, uses `LanguageModelV3` provider models, and keeps React Server Component helpers such as `streamUI` in `@ai-sdk/rsc`.

## Usage

Use `AxAIProvider` anywhere AI SDK v7 accepts a language model.

```typescript
import { generateText } from 'ai';
import { ai } from '@ax-llm/ax';
import { AxAIProvider } from '@ax-llm/ax-ai-sdk-provider';

const axAI = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY ?? '',
});

const model = new AxAIProvider(axAI);

const result = await generateText({
  model,
  prompt: 'Write a haiku about typed AI SDK providers.',
});

console.log(result.text);
```

For React Server Component helpers such as `streamUI`, install `@ai-sdk/rsc` and import those helpers from that package.
