---
title: AxRateLimiterFunction
---

> **AxRateLimiterFunction**: \<`T`\>(`reqFunc`, `info`) => `Promise`\<`T` \| `ReadableStream`\<`T`\>\>

Defined in: [src/ax/ai/types.ts:201](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaitypestsl201)

## Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `T` | `unknown` |

## Parameters

| Parameter | Type |
| ------ | ------ |
| `reqFunc` | () => `Promise`\<`T` \| `ReadableStream`\<`T`\>\> |
| `info` | `Readonly`\<\{ `embedModelUsage`: [`AxTokenUsage`](#apidocs/typealiasaxtokenusage); `modelUsage`: [`AxTokenUsage`](#apidocs/typealiasaxtokenusage); \}\> |

## Returns

`Promise`\<`T` \| `ReadableStream`\<`T`\>\>
