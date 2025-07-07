---
title: AxAIServiceActionOptions
---

```ts
type AxAIServiceActionOptions<TModel, TEmbedModel> = object;
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/types.ts#L286

## Type Parameters

| Type Parameter | Default type |
| :------ | :------ |
| `TModel` | `unknown` |
| `TEmbedModel` | `unknown` |

## Type declaration

| Name | Type |
| :------ | :------ |
| <a id="abortSignal"></a> `abortSignal`? | `AbortSignal` |
| <a id="ai"></a> `ai`? | `Readonly`\<[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)\<`TModel`, `TEmbedModel`\>\> |
| <a id="debug"></a> `debug`? | `boolean` |
| <a id="debugHideSystemPrompt"></a> `debugHideSystemPrompt`? | `boolean` |
| <a id="logger"></a> `logger`? | [`AxLoggerFunction`](/api/#03-apidocs/typealiasaxloggerfunction) |
| <a id="rateLimiter"></a> `rateLimiter`? | [`AxRateLimiterFunction`](/api/#03-apidocs/typealiasaxratelimiterfunction) |
| <a id="sessionId"></a> `sessionId`? | `string` |
| <a id="timeout"></a> `timeout`? | `number` |
| <a id="traceContext"></a> `traceContext`? | `Context` |
| <a id="traceId"></a> `traceId`? | `string` |
