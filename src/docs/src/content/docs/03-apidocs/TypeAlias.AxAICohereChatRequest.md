---
title: AxAICohereChatRequest
---

```ts
type AxAICohereChatRequest = object;
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/cohere/types.ts#L41

## Type declaration

| Name | Type |
| :------ | :------ |
| <a id="chat_history"></a> `chat_history` | ( \| \{ `message`: `string`; `role`: `"CHATBOT"`; `tool_calls`: [`AxAICohereChatResponseToolCalls`](/api/#03-apidocs/typealiasaxaicoherechatresponsetoolcalls); \} \| \{ `message`: `string`; `role`: `"SYSTEM"`; \} \| \{ `message`: `string`; `role`: `"USER"`; \} \| \{ `message`: `string`; `role`: `"TOOL"`; `tool_results`: [`AxAICohereChatRequestToolResults`](/api/#03-apidocs/typealiasaxaicoherechatrequesttoolresults); \})[] |
| <a id="end_sequences"></a> `end_sequences`? | readonly `string`[] |
| <a id="frequency_penalty"></a> `frequency_penalty`? | `number` |
| <a id="k"></a> `k`? | `number` |
| <a id="max_tokens"></a> `max_tokens`? | `number` |
| <a id="message"></a> `message`? | `string` |
| <a id="model"></a> `model` | [`AxAICohereModel`](/api/#03-apidocs/enumerationaxaicoheremodel) |
| <a id="p"></a> `p`? | `number` |
| <a id="preamble"></a> `preamble`? | `string` |
| <a id="presence_penalty"></a> `presence_penalty`? | `number` |
| <a id="stop_sequences"></a> `stop_sequences`? | `string`[] |
| <a id="temperature"></a> `temperature`? | `number` |
| <a id="tool_results"></a> `tool_results`? | [`AxAICohereChatRequestToolResults`](/api/#03-apidocs/typealiasaxaicoherechatrequesttoolresults) |
| <a id="tools"></a> `tools`? | `object`[] |
