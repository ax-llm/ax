---
title: AxInternalChatRequest
---

```ts
type AxInternalChatRequest<TModel> = Omit<AxChatRequest, "model"> & Required<Pick<AxChatRequest<TModel>, "model">>;
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/types.ts#L215

## Type Parameters

| Type Parameter |
| :------ |
| `TModel` |
