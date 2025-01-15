---
title: AxAICohereChatRequest
---

> **AxAICohereChatRequest**: `object`

Defined in: [src/ax/ai/cohere/types.ts:41](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaicoheretypestsl41)

## Type declaration

<a id="chat_history"></a>

### chat\_history

> **chat\_history**: (\{ `message`: `string`; `role`: `"CHATBOT"`; `tool_calls`: [`AxAICohereChatResponseToolCalls`](#apidocs/typealiasaxaicoherechatresponsetoolcalls); \} \| \{ `message`: `string`; `role`: `"SYSTEM"`; \} \| \{ `message`: `string`; `role`: `"USER"`; \} \| \{ `message`: `string`; `role`: `"TOOL"`; `tool_results`: [`AxAICohereChatRequestToolResults`](#apidocs/typealiasaxaicoherechatrequesttoolresults); \})[]

<a id="end_sequences"></a>

### end\_sequences?

> `optional` **end\_sequences**: readonly `string`[]

<a id="frequency_penalty"></a>

### frequency\_penalty?

> `optional` **frequency\_penalty**: `number`

<a id="k"></a>

### k?

> `optional` **k**: `number`

<a id="max_tokens"></a>

### max\_tokens?

> `optional` **max\_tokens**: `number`

<a id="message"></a>

### message?

> `optional` **message**: `string`

<a id="model"></a>

### model

> **model**: [`AxAICohereModel`](#apidocs/enumerationaxaicoheremodel) \| `string`

<a id="p"></a>

### p?

> `optional` **p**: `number`

<a id="preamble"></a>

### preamble?

> `optional` **preamble**: `string`

<a id="presence_penalty"></a>

### presence\_penalty?

> `optional` **presence\_penalty**: `number`

<a id="stop_sequences"></a>

### stop\_sequences?

> `optional` **stop\_sequences**: `string`[]

<a id="temperature"></a>

### temperature?

> `optional` **temperature**: `number`

<a id="tool_results"></a>

### tool\_results?

> `optional` **tool\_results**: [`AxAICohereChatRequestToolResults`](#apidocs/typealiasaxaicoherechatrequesttoolresults)

<a id="tools"></a>

### tools?

> `optional` **tools**: `object`[]
