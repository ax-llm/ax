---
title: AxAIOpenAIChatResponseDelta
---

```ts
type AxAIOpenAIChatResponseDelta = AxAIOpenAIResponseDelta<{
  content: string;
  reasoning_content: string;
  role: string;
  tool_calls: NonNullable<...[...][0]["message"]["tool_calls"]>[0] & object[];
}>;
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/openai/chat_types.ts#L195
