---
title: AxAIAnthropicChatResponse
---

> **AxAIAnthropicChatResponse**: `object`

Defined in: [src/ax/ai/anthropic/types.ts:97](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaianthropictypestsl97)

## Type declaration

<a id="content"></a>

### content

> **content**: (\{ `text`: `string`; `type`: `"text"`; \} \| \{ `id`: `string`; `input`: `string`; `name`: `string`; `type`: `"tool_use"`; \})[]

<a id="id"></a>

### id

> **id**: `string`

<a id="model"></a>

### model

> **model**: `string`

<a id="role"></a>

### role

> **role**: `"assistant"`

<a id="stop_reason"></a>

### stop\_reason

> **stop\_reason**: `"end_turn"` \| `"max_tokens"` \| `"stop_sequence"` \| `"tool_use"`

<a id="stop_sequence"></a>

### stop\_sequence?

> `optional` **stop\_sequence**: `string`

<a id="type"></a>

### type

> **type**: `"message"`

### usage

> \{ `input_tokens`: `number`; `output_tokens`: `number`; \}
