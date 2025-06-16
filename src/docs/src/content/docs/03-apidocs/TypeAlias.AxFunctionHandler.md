---
title: AxFunctionHandler
---

```ts
type AxFunctionHandler = (args?: any, extra?: Readonly<{
  ai: AxAIService;
  debug: boolean;
  sessionId: string;
  traceId: string;
 }>) => unknown;
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/types.ts#L53

## Parameters

| Parameter | Type |
| :------ | :------ |
| `args`? | `any` |
| `extra`? | `Readonly`\<\{ `ai`: [`AxAIService`](/api/#03-apidocs/interfaceaxaiservice); `debug`: `boolean`; `sessionId`: `string`; `traceId`: `string`; \}\> |

## Returns

`unknown`
