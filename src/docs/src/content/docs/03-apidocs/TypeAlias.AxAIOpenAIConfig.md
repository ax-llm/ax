---
title: AxAIOpenAIConfig
---

> **AxAIOpenAIConfig**\<`TModel`, `TEmbedModel`\>: `Omit`\<[`AxModelConfig`](/api/#03-apidocs/typealiasaxmodelconfig), `"topK"`\> & `object`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/openai/types.ts#L25

## Type declaration

### bestOf?

> `optional` **bestOf**: `number`

### dimensions?

> `optional` **dimensions**: `number`

### echo?

> `optional` **echo**: `boolean`

### embedModel?

> `optional` **embedModel**: `TEmbedModel`

### logitBias?

> `optional` **logitBias**: `Map`\<`string`, `number`\>

### logprobs?

> `optional` **logprobs**: `number`

### model

> **model**: `TModel`

### reasoningEffort?

> `optional` **reasoningEffort**: `"low"` \| `"medium"` \| `"high"`

### responseFormat?

> `optional` **responseFormat**: `"json_object"`

### stop?

> `optional` **stop**: `string`[]

### store?

> `optional` **store**: `boolean`

### suffix?

> `optional` **suffix**: `string` \| `null`

### user?

> `optional` **user**: `string`

## Type Parameters

| Type Parameter |
| ------ |
| `TModel` |
| `TEmbedModel` |
