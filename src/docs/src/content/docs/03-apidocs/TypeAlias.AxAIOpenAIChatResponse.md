---
title: AxAIOpenAIChatResponse
---

```ts
type AxAIOpenAIChatResponse = object;
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/openai/chat_types.ts#L165

## Type declaration

| Name | Type |
| :------ | :------ |
| <a id="choices"></a> `choices` | `object`[] |
| <a id="created"></a> `created` | `number` |
| <a id="error"></a> `error`? | \{ `code`: `number`; `message`: `string`; `param`: `string`; `type`: `string`; \} |
| <a id="id"></a> `id` | `string` |
| <a id="model"></a> `model` | `string` |
| <a id="object"></a> `object` | `"chat.completion"` |
| <a id="system_fingerprint"></a> `system_fingerprint` | `string` |
| <a id="usage"></a> `usage`? | [`AxAIOpenAIUsage`](/api/#03-apidocs/typealiasaxaiopenaiusage) |
