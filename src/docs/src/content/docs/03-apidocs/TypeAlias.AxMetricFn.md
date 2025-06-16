---
title: AxMetricFn
---

```ts
type AxMetricFn = <T>(arg0: Readonly<{
  example: AxExample;
  prediction: T;
 }>) => number;
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/optimize.ts#L16

## Type Parameters

| Type Parameter | Default type |
| :------ | :------ |
| `T` *extends* [`AxGenOut`](/api/#03-apidocs/typealiasaxgenout) | [`AxGenOut`](/api/#03-apidocs/typealiasaxgenout) |

## Parameters

| Parameter | Type |
| :------ | :------ |
| `arg0` | `Readonly`\<\{ `example`: [`AxExample`](/api/#03-apidocs/typealiasaxexample); `prediction`: `T`; \}\> |

## Returns

`number`
