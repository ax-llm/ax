---
title: AxPromptTemplate
---

Defined in: [src/ax/dsp/prompt.ts:22](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprompttsl22)

## Constructors

<a id="Constructors"></a>

### new AxPromptTemplate()

> **new AxPromptTemplate**(`sig`, `functions`?, `fieldTemplates`?): [`AxPromptTemplate`](#apidocs/classaxprompttemplate)

Defined in: [src/ax/dsp/prompt.ts:27](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprompttsl27)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `sig` | `Readonly`\<[`AxSignature`](#apidocs/classaxsignature)\> |
| `functions`? | `Readonly`\<[`AxInputFunctionType`](#apidocs/typealiasaxinputfunctiontype)\> |
| `fieldTemplates`? | `Record`\<`string`, [`AxFieldTemplateFn`](#apidocs/typealiasaxfieldtemplatefn)\> |

#### Returns

[`AxPromptTemplate`](#apidocs/classaxprompttemplate)

## Methods

<a id="render"></a>

### render()

> **render**\<`T`\>(`values`, `__namedParameters`): `Readonly`\<\{ `cache`: `boolean`; `content`: `string`; `role`: `"system"`; \} \| \{ `content`: `string` \| (\{ `cache`: `boolean`; `text`: `string`; `type`: `"text"`; \} \| \{ `cache`: `boolean`; `details`: `"high"` \| `"low"` \| `"auto"`; `image`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `cache`: `boolean`; `data`: `string`; `format`: `"wav"`; `type`: `"audio"`; \})[]; `name`: `string`; `role`: `"user"`; \} \| \{ `cache`: `boolean`; `content`: `string`; `functionCalls`: `object`[]; `name`: `string`; `role`: `"assistant"`; \} \| \{ `cache`: `boolean`; `functionId`: `string`; `result`: `string`; `role`: `"function"`; \}\>[]

Defined in: [src/ax/dsp/prompt.ts:81](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprompttsl81)

#### Type Parameters

| Type Parameter |
| ------ |
| `T` *extends* `Record`\<`string`, [`AxFieldValue`](#apidocs/typealiasaxfieldvalue)\> |

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `values` | `T` |
| `__namedParameters` | `Readonly`\<\{ `demos`: `Record`\<`string`, [`AxFieldValue`](#apidocs/typealiasaxfieldvalue)\>[]; `examples`: `Record`\<`string`, [`AxFieldValue`](#apidocs/typealiasaxfieldvalue)\>[]; `skipSystemPrompt`: `boolean`; \}\> |

#### Returns

`Readonly`\<\{ `cache`: `boolean`; `content`: `string`; `role`: `"system"`; \} \| \{ `content`: `string` \| (\{ `cache`: `boolean`; `text`: `string`; `type`: `"text"`; \} \| \{ `cache`: `boolean`; `details`: `"high"` \| `"low"` \| `"auto"`; `image`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `cache`: `boolean`; `data`: `string`; `format`: `"wav"`; `type`: `"audio"`; \})[]; `name`: `string`; `role`: `"user"`; \} \| \{ `cache`: `boolean`; `content`: `string`; `functionCalls`: `object`[]; `name`: `string`; `role`: `"assistant"`; \} \| \{ `cache`: `boolean`; `functionId`: `string`; `result`: `string`; `role`: `"function"`; \}\>[]

***

<a id="renderExtraFields"></a>

### renderExtraFields()

> **renderExtraFields**(`extraFields`): `string` \| (\{ `cache`: `boolean`; `text`: `string`; `type`: `"text"`; \} \| \{ `cache`: `boolean`; `details`: `"high"` \| `"low"` \| `"auto"`; `image`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `cache`: `boolean`; `data`: `string`; `format`: `"wav"`; `type`: `"audio"`; \})[]

Defined in: [src/ax/dsp/prompt.ts:146](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprompttsl146)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `extraFields` | readonly [`AxIField`](#apidocs/typealiasaxifield)[] |

#### Returns

`string` \| (\{ `cache`: `boolean`; `text`: `string`; `type`: `"text"`; \} \| \{ `cache`: `boolean`; `details`: `"high"` \| `"low"` \| `"auto"`; `image`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `cache`: `boolean`; `data`: `string`; `format`: `"wav"`; `type`: `"audio"`; \})[]
