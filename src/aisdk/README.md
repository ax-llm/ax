## Vercel AI SDK Integration

Install the ax provider package

```shell
npm i @ax-llm/ax-ai-sdk-provider
```

### AI SDK v5 Compatibility

This provider is fully compatible with **AI SDK v5** and implements the `LanguageModelV2` specification. It supports:

- ✅ **Text Generation**: Standard text completion and chat functionality
- ✅ **Tool Calling**: Function calls with proper serialization/deserialization
- ✅ **Streaming**: Enhanced streaming with proper lifecycle events (`stream-start`, `text-start`, `text-delta`, `text-end`, `finish`)
- ✅ **Multi-modal**: Support for text and file inputs (images, documents)
- ✅ **Token Usage**: Accurate tracking with `inputTokens`, `outputTokens`, and `totalTokens`

> **Note**: If you're upgrading from AI SDK v4, this provider handles all the necessary conversions between v1 and v2 specification formats automatically.

## Usage

You can use it with the AI SDK, either with the AI provider or the Agent Provider

```typescript
const ai = new AxAI({
    name: "openai",
    apiKey: process.env["OPENAI_APIKEY"] ?? "",
});

// Create a model using the provider
const model = new AxAIProvider(ai);

export const foodAgent = new AxAgent({
    name: "food-search",
    description:
        "Use this agent to find restaurants based on what the customer wants",
    signature,
    functions,
});

// Get vercel ai sdk state
const aiState = getMutableAIState();

// Create an agent for a specific task
const foodAgent = new AxAgentProvider(ai, {
    agent: foodAgent,
    updateState: (state) => {
        aiState.done({ ...aiState.get(), state });
    },
    generate: async ({ restaurant, priceRange }) => {
        return (
            <BotCard>
                <h1>{restaurant as string} {priceRange as string}</h1>
            </BotCard>
        );
    },
});

// Use with streamUI a critical part of building chat UIs in the AI SDK
const result = await streamUI({
    model,
    initial: <SpinnerMessage />,
    messages: [
        // ...
    ],
    text: ({ content, done, delta }) => {
        // ...
    },
    tools: {
        // @ts-ignore
        "find-food": foodAgent,
    },
});
```
