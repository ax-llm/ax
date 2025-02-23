---
title: AxChatRequest
---

> **AxChatRequest**\<`TModel`\>: `object`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/types.ts#L113

## Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `TModel` | `string` |

## Type declaration

<a id="chatPrompt"></a>

### chatPrompt

> **chatPrompt**: (\{ `cache`: `boolean`; `content`: `string`; `role`: `"system"`; \} \| \{ `content`: `string` \| (\{ `cache`: `boolean`; `text`: `string`; `type`: `"text"`; \} \| \{ `cache`: `boolean`; `details`: ... \| ... \| ...; `image`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `cache`: `boolean`; `data`: `string`; `format`: `"wav"`; `type`: `"audio"`; \})[]; `name`: `string`; `role`: `"user"`; \} \| \{ `cache`: `boolean`; `content`: `string`; `functionCalls`: `object`[]; `name`: `string`; `role`: `"assistant"`; \} \| \{ `cache`: `boolean`; `functionId`: `string`; `isError`: `boolean`; `result`: `string`; `role`: `"function"`; \})[]

<a id="functionCall"></a>

### functionCall?

> `optional` **functionCall**: `"none"` \| `"auto"` \| `"required"` \| \{ `function`: \{ `name`: `string`; \}; `type`: `"function"`; \}

<a id="functions"></a>

### functions?

> `optional` **functions**: `Readonly`\<\{ `description`: `string`; `name`: `string`; `parameters`: [`AxFunctionJSONSchema`](/api/#03-apidocs/typealiasaxfunctionjsonschema); \}\>[]

<a id="model"></a>

### model?

> `optional` **model**: `TModel`

<a id="modelConfig"></a>

### modelConfig?

> `optional` **modelConfig**: [`AxModelConfig`](/api/#03-apidocs/typealiasaxmodelconfig)
