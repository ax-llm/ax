## Vercel AI SDK Integration

Install the ax provider package

```shell
npm i @ax-llm/ax-ai-sdk-provider
```

### AI SDK v6 Compatibility

This provider is compatible with **AI SDK v6** and implements the `LanguageModelV3` specification. It supports:

- **Text Generation**: Standard text completion and chat functionality
- **Tool Calling**: Function calls with proper serialization/deserialization
- **Streaming**: Streaming lifecycle events (`stream-start`, `text-start`, `text-delta`, `text-end`, `finish`)
- **Multi-modal**: Support for text and file inputs (images, documents)
- **Token Usage**: AI SDK v6 usage shape with nested `inputTokens` and `outputTokens`

AI SDK v6 renamed `CoreMessage` to `ModelMessage`, moved React Server Component helpers such as `streamUI` to `@ai-sdk/rsc`, and uses `LanguageModelV3` provider models.

## Usage

Use `AxAIProvider` anywhere AI SDK v6 accepts a language model.

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
