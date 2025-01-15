---
title: AxAIAnthropicChatRequest
---

> **AxAIAnthropicChatRequest**: `object`

Defined in: [src/ax/ai/anthropic/types.ts:24](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaianthropictypestsl24)

## Type declaration

<a id="max_tokens"></a>

### max\_tokens?

> `optional` **max\_tokens**: `number`

<a id="messages"></a>

### messages

> **messages**: (\{ `content`: `string` \| (... & ... \| ... & ... \| \{ `content`: ... \| ...; `is_error`: `boolean`; `tool_use_id`: `string`; `type`: `"tool_result"`; \})[]; `role`: `"user"`; \} \| \{ `content`: `string` \| (\{ `text`: `string`; `type`: `"text"`; \} \| \{ `id`: `string`; `input`: `object`; `name`: `string`; `type`: `"tool_use"`; \})[]; `role`: `"assistant"`; \})[]

### metadata?

> \{ `user_id`: `string`; \}

<a id="model"></a>

### model

> **model**: `string`

<a id="stop_sequences"></a>

### stop\_sequences?

> `optional` **stop\_sequences**: `string`[]

<a id="stream"></a>

### stream?

> `optional` **stream**: `boolean`

<a id="system"></a>

### system?

> `optional` **system**: `string` \| `object` & [`AxAIAnthropicChatRequestCacheParam`](#apidocs/typealiasaxaianthropicchatrequestcacheparam)[]

<a id="temperature"></a>

### temperature?

> `optional` **temperature**: `number`

<a id="tool_choice"></a>

### tool\_choice?

> `optional` **tool\_choice**: \{ `type`: `"auto"` \| `"any"`; \} \| \{ `name`: `string`; `type`: `"tool"`; \}

<a id="tools"></a>

### tools?

> `optional` **tools**: `object` & [`AxAIAnthropicChatRequestCacheParam`](#apidocs/typealiasaxaianthropicchatrequestcacheparam)[]

<a id="top_k"></a>

### top\_k?

> `optional` **top\_k**: `number`

<a id="top_p"></a>

### top\_p?

> `optional` **top\_p**: `number`
