---
title: AxAIRekaChatRequest
---

```ts
type AxAIRekaChatRequest = object;
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/reka/types.ts#L20

## Type declaration

| Name | Type |
| :------ | :------ |
| <a id="frequency_penalty"></a> `frequency_penalty`? | `number` |
| <a id="max_tokens"></a> `max_tokens`? | `number` |
| <a id="messages"></a> `messages` | ( \| \{ `content`: `string` \| `object`[]; `role`: `"user"`; \} \| \{ `content`: `string` \| `object`[]; `role`: `"assistant"`; \})[] |
| <a id="model"></a> `model` | `string` |
| <a id="presence_penalty"></a> `presence_penalty`? | `number` |
| <a id="response_format"></a> `response_format`? | \{ `type`: `string`; \} |
| <a id="stop"></a> `stop`? | readonly `string`[] |
| <a id="stream"></a> `stream`? | `boolean` |
| <a id="temperature"></a> `temperature`? | `number` |
| <a id="top_k"></a> `top_k`? | `number` |
| <a id="top_p"></a> `top_p`? | `number` |
| <a id="usage"></a> `usage`? | [`AxAIRekaUsage`](/api/#03-apidocs/typealiasaxairekausage) |
| <a id="use_search_engine"></a> `use_search_engine`? | `boolean` |
