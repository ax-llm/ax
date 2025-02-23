---
title: AxAIAnthropicChatRequest
---

> **AxAIAnthropicChatRequest**: `object`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/anthropic/types.ts#L32

## Type declaration

<a id="anthropic_version"></a>

### anthropic\_version?

> `optional` **anthropic\_version**: `string`

<a id="max_tokens"></a>

### max\_tokens?

> `optional` **max\_tokens**: `number`

<a id="messages"></a>

### messages

> **messages**: (\{ `content`: `string` \| (... & ... \| ... & ... \| \{ `content`: ... \| ...; `is_error`: `boolean`; `tool_use_id`: `string`; `type`: `"tool_result"`; \})[]; `role`: `"user"`; \} \| \{ `content`: `string` \| (\{ `text`: `string`; `type`: `"text"`; \} \| \{ `id`: `string`; `input`: `object`; `name`: `string`; `type`: `"tool_use"`; \})[]; `role`: `"assistant"`; \})[]

### metadata?

> \{ `user_id`: `string`; \}

<a id="model"></a>

### model?

> `optional` **model**: `string`

<a id="stop_sequences"></a>

### stop\_sequences?

> `optional` **stop\_sequences**: `string`[]

<a id="stream"></a>

### stream?

> `optional` **stream**: `boolean`

<a id="system"></a>

### system?

> `optional` **system**: `string` \| `object` & [`AxAIAnthropicChatRequestCacheParam`](/api/#03-apidocs/typealiasaxaianthropicchatrequestcacheparam)[]

<a id="temperature"></a>

### temperature?

> `optional` **temperature**: `number`

<a id="tool_choice"></a>

### tool\_choice?

> `optional` **tool\_choice**: \{ `type`: `"auto"` \| `"any"`; \} \| \{ `name`: `string`; `type`: `"tool"`; \}

<a id="tools"></a>

### tools?

> `optional` **tools**: `object` & [`AxAIAnthropicChatRequestCacheParam`](/api/#03-apidocs/typealiasaxaianthropicchatrequestcacheparam)[]

<a id="top_k"></a>

### top\_k?

> `optional` **top\_k**: `number`

<a id="top_p"></a>

### top\_p?

> `optional` **top\_p**: `number`
