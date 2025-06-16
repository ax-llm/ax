---
title: AxAIAnthropicChatRequest
---

```ts
type AxAIAnthropicChatRequest = object;
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/anthropic/types.ts#L37

## Type declaration

| Name | Type |
| :------ | :------ |
| <a id="anthropic_version"></a> `anthropic_version`? | `string` |
| <a id="max_tokens"></a> `max_tokens`? | `number` |
| <a id="messages"></a> `messages` | ( \| \{ `content`: \| `string` \| ( \| ... & ... \| ... & ... \| \{ `content`: ... \| ...; `is_error`: `boolean`; `tool_use_id`: `string`; `type`: `"tool_result"`; \})[]; `role`: `"user"`; \} \| \{ `content`: \| `string` \| ( \| \{ `text`: `string`; `type`: `"text"`; \} \| \{ `id`: `string`; `input`: `object`; `name`: `string`; `type`: `"tool_use"`; \})[]; `role`: `"assistant"`; \})[] |
| <a id="metadata"></a> `metadata`? | \{ `user_id`: `string`; \} |
| <a id="model"></a> `model`? | `string` |
| <a id="stop_sequences"></a> `stop_sequences`? | `string`[] |
| <a id="stream"></a> `stream`? | `boolean` |
| <a id="system"></a> `system`? | \| `string` \| `object` & [`AxAIAnthropicChatRequestCacheParam`](/api/#03-apidocs/typealiasaxaianthropicchatrequestcacheparam)[] |
| <a id="temperature"></a> `temperature`? | `number` |
| <a id="tool_choice"></a> `tool_choice`? | \| \{ `type`: `"auto"` \| `"any"`; \} \| \{ `name`: `string`; `type`: `"tool"`; \} |
| <a id="tools"></a> `tools`? | `object` & [`AxAIAnthropicChatRequestCacheParam`](/api/#03-apidocs/typealiasaxaianthropicchatrequestcacheparam)[] |
| <a id="top_k"></a> `top_k`? | `number` |
| <a id="top_p"></a> `top_p`? | `number` |
