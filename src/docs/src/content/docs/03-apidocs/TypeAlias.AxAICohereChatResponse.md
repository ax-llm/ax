---
title: AxAICohereChatResponse
---

```ts
type AxAICohereChatResponse = object;
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/cohere/types.ts#L89

## Type declaration

| Name | Type |
| :------ | :------ |
| <a id="finish_reason"></a> `finish_reason` | \| `"COMPLETE"` \| `"ERROR"` \| `"ERROR_TOXIC"` \| `"ERROR_LIMIT"` \| `"USER_CANCEL"` \| `"MAX_TOKENS"` |
| <a id="generation_id"></a> `generation_id` | `string` |
| <a id="meta"></a> `meta` | \{ `billed_units`: \{ `input_tokens`: `number`; `output_tokens`: `number`; \}; \} |
| <a id="response_id"></a> `response_id` | `string` |
| <a id="text"></a> `text` | `string` |
| <a id="tool_calls"></a> `tool_calls` | [`AxAICohereChatResponseToolCalls`](/api/#03-apidocs/typealiasaxaicoherechatresponsetoolcalls) |
