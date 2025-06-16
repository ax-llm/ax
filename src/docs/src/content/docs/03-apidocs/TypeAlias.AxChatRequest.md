---
title: AxChatRequest
---

```ts
type AxChatRequest<TModel> = object;
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/types.ts#L124

## Type Parameters

| Type Parameter | Default type |
| :------ | :------ |
| `TModel` | `string` |

## Type declaration

| Name | Type |
| :------ | :------ |
| <a id="chatPrompt"></a> `chatPrompt` | ( \| \{ `cache`: `boolean`; `content`: `string`; `role`: `"system"`; \} \| \{ `content`: \| `string` \| ( \| \{ `cache`: `boolean`; `text`: `string`; `type`: `"text"`; \} \| \{ `cache`: `boolean`; `details`: ... \| ... \| ...; `image`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `cache`: `boolean`; `data`: `string`; `format`: `"wav"`; `type`: `"audio"`; \})[]; `name`: `string`; `role`: `"user"`; \} \| \{ `cache`: `boolean`; `content`: `string`; `functionCalls`: `object`[]; `name`: `string`; `role`: `"assistant"`; \} \| \{ `cache`: `boolean`; `functionId`: `string`; `isError`: `boolean`; `result`: `string`; `role`: `"function"`; \})[] |
| <a id="functionCall"></a> `functionCall`? | \| `"none"` \| `"auto"` \| `"required"` \| \{ `function`: \{ `name`: `string`; \}; `type`: `"function"`; \} |
| <a id="functions"></a> `functions`? | `Readonly`\<\{ `description`: `string`; `name`: `string`; `parameters`: [`AxFunctionJSONSchema`](/api/#03-apidocs/typealiasaxfunctionjsonschema); \}\>[] |
| <a id="model"></a> `model`? | `TModel` |
| <a id="modelConfig"></a> `modelConfig`? | [`AxModelConfig`](/api/#03-apidocs/typealiasaxmodelconfig) |
