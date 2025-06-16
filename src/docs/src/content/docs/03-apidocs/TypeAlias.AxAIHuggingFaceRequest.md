---
title: AxAIHuggingFaceRequest
---

```ts
type AxAIHuggingFaceRequest = object;
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/huggingface/types.ts#L16

## Type declaration

| Name | Type |
| :------ | :------ |
| <a id="inputs"></a> `inputs` | `string` |
| <a id="model"></a> `model` | [`AxAIHuggingFaceModel`](/api/#03-apidocs/enumerationaxaihuggingfacemodel) |
| <a id="options"></a> `options`? | \{ `use_cache`: `boolean`; `wait_for_model`: `boolean`; \} |
| <a id="parameters"></a> `parameters` | \{ `do_sample`: `boolean`; `max_new_tokens`: `number`; `max_time`: `number`; `num_return_sequences`: `number`; `repetition_penalty`: `number`; `return_full_text`: `boolean`; `temperature`: `number`; `top_k`: `number`; `top_p`: `number`; \} |
