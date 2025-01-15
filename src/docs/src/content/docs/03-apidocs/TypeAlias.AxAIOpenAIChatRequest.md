---
title: AxAIOpenAIChatRequest
---

> **AxAIOpenAIChatRequest**: `object`

Defined in: [src/ax/ai/openai/types.ts:65](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaiopenaitypestsl65)

## Type declaration

<a id="frequency_penalty"></a>

### frequency\_penalty?

> `optional` **frequency\_penalty**: `number`

<a id="logit_bias"></a>

### logit\_bias?

> `optional` **logit\_bias**: `Map`\<`string`, `number`\>

<a id="max_tokens"></a>

### max\_tokens

> **max\_tokens**: `number`

<a id="messages"></a>

### messages

> **messages**: (\{ `content`: `string`; `role`: `"system"`; \} \| \{ `content`: `string` \| (\{ `text`: `string`; `type`: `"text"`; \} \| \{ `image_url`: \{ `details`: ...; `url`: ...; \}; `type`: `"image_url"`; \} \| \{ `input_audio`: \{ `data`: ...; `format`: ...; \}; `type`: `"input_audio"`; \})[]; `name`: `string`; `role`: `"user"`; \} \| \{ `content`: `string`; `name`: `string`; `role`: `"assistant"`; `tool_calls`: `object`[]; \} \| \{ `content`: `string`; `role`: `"tool"`; `tool_call_id`: `string`; \})[]

<a id="model"></a>

### model

> **model**: `string`

<a id="n"></a>

### n?

> `optional` **n**: `number`

<a id="organization"></a>

### organization?

> `optional` **organization**: `string`

<a id="presence_penalty"></a>

### presence\_penalty?

> `optional` **presence\_penalty**: `number`

### response\_format?

> \{ `type`: `string`; \}

<a id="stop"></a>

### stop?

> `optional` **stop**: readonly `string`[]

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
