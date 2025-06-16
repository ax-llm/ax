---
title: AxRateLimiterFunction
---

```ts
type AxRateLimiterFunction = <T>(reqFunc: () => Promise<T | ReadableStream<T>>, info: Readonly<{
  modelUsage: AxModelUsage;
}>) => Promise<T | ReadableStream<T>>;
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/types.ts#L229

## Type Parameters

| Type Parameter | Default type |
| :------ | :------ |
| `T` | `unknown` |

## Parameters

| Parameter | Type |
| :------ | :------ |
| `reqFunc` | () => `Promise`\<`T` \| `ReadableStream`\<`T`\>\> |
| `info` | `Readonly`\<\{ `modelUsage`: [`AxModelUsage`](/api/#03-apidocs/typealiasaxmodelusage); \}\> |

## Returns

`Promise`\<`T` \| `ReadableStream`\<`T`\>\>
