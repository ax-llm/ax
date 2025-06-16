---
title: AxAIRekaConfig
---

```ts
type AxAIRekaConfig = Omit<AxModelConfig, "topK"> & object;
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/reka/types.ts#L9

## Type declaration

| Name | Type |
| :------ | :------ |
| `model` | [`AxAIRekaModel`](/api/#03-apidocs/enumerationaxairekamodel) |
| `stop`? | readonly `string`[] |
| `useSearchEngine`? | `boolean` |
