---
title: AxAIAnthropicChatResponse
---

```ts
type AxAIAnthropicChatResponse = object;
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/anthropic/types.ts#L111

## Type declaration

| Name | Type |
| :------ | :------ |
| <a id="content"></a> `content` | ( \| \{ `text`: `string`; `type`: `"text"`; \} \| \{ `id`: `string`; `input`: `string`; `name`: `string`; `type`: `"tool_use"`; \})[] |
| <a id="id"></a> `id` | `string` |
| <a id="model"></a> `model` | `string` |
| <a id="role"></a> `role` | `"assistant"` |
| <a id="stop_reason"></a> `stop_reason` | `"end_turn"` \| `"max_tokens"` \| `"stop_sequence"` \| `"tool_use"` |
| <a id="stop_sequence"></a> `stop_sequence`? | `string` |
| <a id="type"></a> `type` | `"message"` |
| <a id="usage"></a> `usage` | \{ `input_tokens`: `number`; `output_tokens`: `number`; \} |
