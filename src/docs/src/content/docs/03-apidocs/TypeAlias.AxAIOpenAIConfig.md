---
title: AxAIOpenAIConfig
---

```ts
type AxAIOpenAIConfig<TModel, TEmbedModel> = Omit<AxModelConfig, "topK"> & object;
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/openai/chat_types.ts#L26

## Type declaration

| Name | Type |
| :------ | :------ |
| `bestOf`? | `number` |
| `dimensions`? | `number` |
| `echo`? | `boolean` |
| `embedModel`? | `TEmbedModel` |
| `logitBias`? | `Map`\<`string`, `number`\> |
| `logprobs`? | `number` |
| `model` | `TModel` |
| `reasoningEffort`? | `"low"` \| `"medium"` \| `"high"` |
| `responseFormat`? | `"json_object"` |
| `serviceTier`? | `"auto"` \| `"default"` \| `"flex"` |
| `stop`? | `string`[] |
| `store`? | `boolean` |
| `suffix`? | `string` \| `null` |
| `user`? | `string` |
| `webSearchOptions`? | \{ `searchContextSize`: `"low"` \| `"medium"` \| `"high"`; `userLocation`: \| \{ `approximate`: \{ `city`: `string`; `country`: `string`; `region`: `string`; `timezone`: `string`; `type`: `"approximate"`; \}; \} \| `null`; \} |

## Type Parameters

| Type Parameter |
| :------ |
| `TModel` |
| `TEmbedModel` |
