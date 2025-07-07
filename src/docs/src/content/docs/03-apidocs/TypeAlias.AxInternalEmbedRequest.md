---
title: AxInternalEmbedRequest
---

```ts
type AxInternalEmbedRequest<TEmbedModel> = Omit<AxEmbedRequest, "embedModel"> & Required<Pick<AxEmbedRequest<TEmbedModel>, "embedModel">>;
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/types.ts#L223

## Type Parameters

| Type Parameter |
| :------ |
| `TEmbedModel` |
