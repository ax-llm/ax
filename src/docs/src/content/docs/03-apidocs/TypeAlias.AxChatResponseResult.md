---
title: AxChatResponseResult
---

```ts
type AxChatResponseResult = object;
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/types.ts#L84

## Type declaration

| Name | Type |
| :------ | :------ |
| <a id="content"></a> `content`? | `string` |
| <a id="finishReason"></a> `finishReason`? | `"stop"` \| `"length"` \| `"function_call"` \| `"content_filter"` \| `"error"` |
| <a id="functionCalls"></a> `functionCalls`? | `object`[] |
| <a id="id"></a> `id`? | `string` |
| <a id="name"></a> `name`? | `string` |
| <a id="thought"></a> `thought`? | `string` |
