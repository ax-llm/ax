---
title: AxRateLimiterFunction
---

> **AxRateLimiterFunction**: \<`T`\>(`reqFunc`, `info`) => `Promise`\<`T` \| `ReadableStream`\<`T`\>\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/types.ts#L218

## Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `T` | `unknown` |

## Parameters

| Parameter | Type |
| ------ | ------ |
| `reqFunc` | () => `Promise`\<`T` \| `ReadableStream`\<`T`\>\> |
| `info` | `Readonly`\<\{ `embedModelUsage`: [`AxTokenUsage`](/api/#03-apidocs/typealiasaxtokenusage); `modelUsage`: [`AxTokenUsage`](/api/#03-apidocs/typealiasaxtokenusage); \}\> |

## Returns

`Promise`\<`T` \| `ReadableStream`\<`T`\>\>
