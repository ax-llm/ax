---
title: AxAIOpenAIConfig
---

> **AxAIOpenAIConfig**: `Omit`\<[`AxModelConfig`](#apidocs/typealiasaxmodelconfig), `"topK"`\> & `object`

Defined in: [src/ax/ai/openai/types.ts:24](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaiopenaitypestsl24)

## Type declaration

### bestOf?

> `optional` **bestOf**: `number`

### dimensions?

> `optional` **dimensions**: `number`

### echo?

> `optional` **echo**: `boolean`

### embedModel?

> `optional` **embedModel**: [`AxAIOpenAIEmbedModel`](#apidocs/enumerationaxaiopenaiembedmodel) \| `string`

### logitBias?

> `optional` **logitBias**: `Map`\<`string`, `number`\>

### logprobs?

> `optional` **logprobs**: `number`

### model

> **model**: [`AxAIOpenAIModel`](#apidocs/enumerationaxaiopenaimodel) \| `string`

### responseFormat?

> `optional` **responseFormat**: `"json_object"`

### stop?

> `optional` **stop**: `string`[]

### suffix?

> `optional` **suffix**: `string` \| `null`

### user?

> `optional` **user**: `string`
