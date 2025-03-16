---
title: Vercel AI SDK Integration
description: Learn how to integrate Ax with the Vercel AI SDK for building AI-powered applications using both the AI provider and Agent provider functionality.
---

```shell
npm i @ax-llm/ax-ai-sdk-provider
```

Then use it with the AI SDK, you can either use the AI provider or the Agent Provider

```typescript
const ai = new AxAI({
    name: 'openai',
    apiKey: process.env['OPENAI_APIKEY'] ?? "",
});

// Create a model using the provider
const model = new AxAIProvider(ai);

export const foodAgent = new AxAgent({
  name: 'food-search',
  description:
    'Use this agent to find restaurants based on what the customer wants',
  signature,
  functions
})

// Get vercel ai sdk state
const aiState = getMutableAIState()

// Create an agent for a specific task
const foodAgent = new AxAgentProvider(ai, {
    agent: foodAgent,
    updateState: (state) => {
         aiState.done({ ...aiState.get(), state })
    },
    generate: async ({ restaurant, priceRange }) => {
        return (
            <BotCard>
                <h1>{restaurant as string} {priceRange as string}</h1>
            </BotCard>
        )
    }
})

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
        'find-food': foodAgent,
    }
})
```