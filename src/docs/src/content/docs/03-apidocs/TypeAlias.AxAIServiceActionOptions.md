---
title: AxAIServiceActionOptions
---

> **AxAIServiceActionOptions**\<`TModel`, `TEmbedModel`\>: `object`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/types.ts#L234

## Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `TModel` | `unknown` |
| `TEmbedModel` | `unknown` |

## Type declaration

<a id="ai"></a>

### ai?

> `optional` **ai**: `Readonly`\<[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)\<`TModel`, `TEmbedModel`\>\>

<a id="debug"></a>

### debug?

> `optional` **debug**: `boolean`

<a id="rateLimiter"></a>

### rateLimiter?

> `optional` **rateLimiter**: [`AxRateLimiterFunction`](/api/#03-apidocs/typealiasaxratelimiterfunction)

<a id="sessionId"></a>

### sessionId?

> `optional` **sessionId**: `string`

<a id="traceId"></a>

### traceId?

> `optional` **traceId**: `string`
