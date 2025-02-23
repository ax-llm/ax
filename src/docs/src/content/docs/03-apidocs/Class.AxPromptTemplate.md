---
title: AxPromptTemplate
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/prompt.ts#L35

## Constructors

<a id="constructors"></a>

### new AxPromptTemplate()

> **new AxPromptTemplate**(`sig`, `functions`?, `fieldTemplates`?): [`AxPromptTemplate`](/api/#03-apidocs/classaxprompttemplate)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/prompt.ts#L40

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `sig` | `Readonly`\<[`AxSignature`](/api/#03-apidocs/classaxsignature)\> |
| `functions`? | `Readonly`\<[`AxInputFunctionType`](/api/#03-apidocs/typealiasaxinputfunctiontype)\> |
| `fieldTemplates`? | `Record`\<`string`, [`AxFieldTemplateFn`](/api/#03-apidocs/typealiasaxfieldtemplatefn)\> |

#### Returns

[`AxPromptTemplate`](/api/#03-apidocs/classaxprompttemplate)

## Methods

<a id="render"></a>

### render()

> **render**\<`T`\>(`values`, `__namedParameters`): (\{ `cache`: `boolean`; `content`: `string`; `role`: `"system"`; \} \| \{ `content`: `string` \| (\{ `cache`: `boolean`; `text`: `string`; `type`: `"text"`; \} \| \{ `cache`: `boolean`; `details`: `"high"` \| `"low"` \| `"auto"`; `image`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `cache`: `boolean`; `data`: `string`; `format`: `"wav"`; `type`: `"audio"`; \})[]; `name`: `string`; `role`: `"user"`; \} \| \{ `cache`: `boolean`; `content`: `string`; `functionCalls`: `object`[]; `name`: `string`; `role`: `"assistant"`; \} \| \{ `cache`: `boolean`; `functionId`: `string`; `isError`: `boolean`; `result`: `string`; `role`: `"function"`; \})[]

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/prompt.ts#L92

#### Type Parameters

| Type Parameter |
| ------ |
| `T` *extends* `Record`\<`string`, [`AxFieldValue`](/api/#03-apidocs/typealiasaxfieldvalue)\> |

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `values` | `T` |
| `__namedParameters` | `Readonly`\<\{ `demos`: `Record`\<`string`, [`AxFieldValue`](/api/#03-apidocs/typealiasaxfieldvalue)\>[]; `examples`: `Record`\<`string`, [`AxFieldValue`](/api/#03-apidocs/typealiasaxfieldvalue)\>[]; `skipSystemPrompt`: `boolean`; \}\> |

#### Returns

(\{ `cache`: `boolean`; `content`: `string`; `role`: `"system"`; \} \| \{ `content`: `string` \| (\{ `cache`: `boolean`; `text`: `string`; `type`: `"text"`; \} \| \{ `cache`: `boolean`; `details`: `"high"` \| `"low"` \| `"auto"`; `image`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `cache`: `boolean`; `data`: `string`; `format`: `"wav"`; `type`: `"audio"`; \})[]; `name`: `string`; `role`: `"user"`; \} \| \{ `cache`: `boolean`; `content`: `string`; `functionCalls`: `object`[]; `name`: `string`; `role`: `"assistant"`; \} \| \{ `cache`: `boolean`; `functionId`: `string`; `isError`: `boolean`; `result`: `string`; `role`: `"function"`; \})[]

***

<a id="renderExtraFields"></a>

### renderExtraFields()

> **renderExtraFields**(`extraFields`): (\{ `cache`: `boolean`; `text`: `string`; `type`: `"text"`; \} \| \{ `cache`: `boolean`; `details`: `"high"` \| `"low"` \| `"auto"`; `image`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `cache`: `boolean`; `data`: `string`; `format`: `"wav"`; `type`: `"audio"`; \})[]

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/prompt.ts#L157

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `extraFields` | readonly [`AxIField`](/api/#03-apidocs/typealiasaxifield)[] |

#### Returns

(\{ `cache`: `boolean`; `text`: `string`; `type`: `"text"`; \} \| \{ `cache`: `boolean`; `details`: `"high"` \| `"low"` \| `"auto"`; `image`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `cache`: `boolean`; `data`: `string`; `format`: `"wav"`; `type`: `"audio"`; \})[]
