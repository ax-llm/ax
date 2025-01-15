---
title: AxChatRequest
---

> **AxChatRequest**: `object`

Defined in: [src/ax/ai/types.ts:100](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaitypestsl100)

## Type declaration

<a id="chatPrompt"></a>

### chatPrompt

> **chatPrompt**: `Readonly`\<\{ `cache`: `boolean`; `content`: `string`; `role`: `"system"`; \} \| \{ `content`: `string` \| (\{ `cache`: `boolean`; `text`: `string`; `type`: `"text"`; \} \| \{ `cache`: `boolean`; `details`: ... \| ... \| ...; `image`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `cache`: `boolean`; `data`: `string`; `format`: `"wav"`; `type`: `"audio"`; \})[]; `name`: `string`; `role`: `"user"`; \} \| \{ `cache`: `boolean`; `content`: `string`; `functionCalls`: `object`[]; `name`: `string`; `role`: `"assistant"`; \} \| \{ `cache`: `boolean`; `functionId`: `string`; `result`: `string`; `role`: `"function"`; \}\>[]

<a id="functionCall"></a>

### functionCall?

> `optional` **functionCall**: `"none"` \| `"auto"` \| `"required"` \| \{ `function`: \{ `name`: `string`; \}; `type`: `"function"`; \}

<a id="functions"></a>

### functions?

> `optional` **functions**: `Readonly`\<\{ `description`: `string`; `name`: `string`; `parameters`: [`AxFunctionJSONSchema`](#apidocs/typealiasaxfunctionjsonschema); \}\>[]

<a id="model"></a>

### model?

> `optional` **model**: `string`

<a id="modelConfig"></a>

### modelConfig?

> `optional` **modelConfig**: `Readonly`\<[`AxModelConfig`](#apidocs/typealiasaxmodelconfig)\>
