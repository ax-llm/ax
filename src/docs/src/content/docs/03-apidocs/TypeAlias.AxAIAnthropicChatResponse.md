---
title: AxAIAnthropicChatResponse
---

> **AxAIAnthropicChatResponse**: `object`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/anthropic/types.ts#L106

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
