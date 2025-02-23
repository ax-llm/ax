---
title: AxAIOpenAIChatRequest
---

> **AxAIOpenAIChatRequest**\<`TModel`\>: `object`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/openai/types.ts#L71

## Type Parameters

| Type Parameter |
| ------ |
| `TModel` |

## Type declaration

<a id="frequency_penalty"></a>

### frequency\_penalty?

> `optional` **frequency\_penalty**: `number`

<a id="logit_bias"></a>

### logit\_bias?

> `optional` **logit\_bias**: `Map`\<`string`, `number`\>

<a id="max_completion_tokens"></a>

### max\_completion\_tokens

> **max\_completion\_tokens**: `number`

<a id="messages"></a>

### messages

> **messages**: (\{ `content`: `string`; `role`: `"system"`; \} \| \{ `content`: `string` \| (\{ `text`: `string`; `type`: `"text"`; \} \| \{ `image_url`: \{ `details`: ...; `url`: ...; \}; `type`: `"image_url"`; \} \| \{ `input_audio`: \{ `data`: ...; `format`: ...; \}; `type`: `"input_audio"`; \})[]; `name`: `string`; `role`: `"user"`; \} \| \{ `content`: `string`; `name`: `string`; `role`: `"assistant"`; `tool_calls`: `object`[]; \} \| \{ `content`: `string`; `role`: `"tool"`; `tool_call_id`: `string`; \})[]

<a id="model"></a>

### model

> **model**: `TModel`

<a id="n"></a>

### n?

> `optional` **n**: `number`

<a id="organization"></a>

### organization?

> `optional` **organization**: `string`

<a id="presence_penalty"></a>

### presence\_penalty?

> `optional` **presence\_penalty**: `number`

<a id="reasoning_effort"></a>

### reasoning\_effort?

> `optional` **reasoning\_effort**: `"low"` \| `"medium"` \| `"high"`

### response\_format?

> \{ `type`: `string`; \}

<a id="stop"></a>

### stop?

> `optional` **stop**: readonly `string`[]

<a id="store"></a>

### store?

> `optional` **store**: `boolean`

<a id="stream"></a>

### stream?

> `optional` **stream**: `boolean`

<a id="temperature"></a>

### temperature?

> `optional` **temperature**: `number`

<a id="tool_choice"></a>

### tool\_choice?

> `optional` **tool\_choice**: `"none"` \| `"auto"` \| `"required"` \| \{ `function`: \{ `name`: `string`; \}; `type`: `"function"`; \}

<a id="tools"></a>

### tools?

> `optional` **tools**: `object`[]

<a id="top_p"></a>

### top\_p?

> `optional` **top\_p**: `number`

<a id="user"></a>

### user?

> `optional` **user**: `string`
