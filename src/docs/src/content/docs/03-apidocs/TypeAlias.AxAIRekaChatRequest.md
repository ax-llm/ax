---
title: AxAIRekaChatRequest
---

> **AxAIRekaChatRequest**: `object`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/reka/types.ts#L20

## Type declaration

<a id="frequency_penalty"></a>

### frequency\_penalty?

> `optional` **frequency\_penalty**: `number`

<a id="max_tokens"></a>

### max\_tokens

> **max\_tokens**: `number`

<a id="messages"></a>

### messages

> **messages**: (\{ `content`: `string` \| `object`[]; `role`: `"user"`; \} \| \{ `content`: `string` \| `object`[]; `role`: `"assistant"`; \})[]

<a id="model"></a>

### model

> **model**: `string`

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

<a id="top_k"></a>

### top\_k?

> `optional` **top\_k**: `number`

<a id="top_p"></a>

### top\_p?

> `optional` **top\_p**: `number`

<a id="usage"></a>

### usage?

> `optional` **usage**: [`AxAIRekaUsage`](/api/#03-apidocs/typealiasaxairekausage)

<a id="use_search_engine"></a>

### use\_search\_engine?

> `optional` **use\_search\_engine**: `boolean`
