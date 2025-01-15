---
title: AxAIMemory
---

Defined in: [src/ax/mem/types.ts:3](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxmemtypestsl3)

## Methods

<a id="add"></a>

### add()

> **add**(`result`, `sessionId`?): `void`

Defined in: [src/ax/mem/types.ts:4](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxmemtypestsl4)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `result` | `Readonly`\<`Readonly`\<\{ `cache`: `boolean`; `content`: `string`; `role`: `"system"`; \} \| \{ `content`: `string` \| (\{ `cache`: `boolean`; `text`: `string`; `type`: `"text"`; \} \| \{ `cache`: `boolean`; `details`: `"high"` \| `"low"` \| `"auto"`; `image`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `cache`: `boolean`; `data`: `string`; `format`: `"wav"`; `type`: `"audio"`; \})[]; `name`: `string`; `role`: `"user"`; \} \| \{ `cache`: `boolean`; `content`: `string`; `functionCalls`: `object`[]; `name`: `string`; `role`: `"assistant"`; \} \| \{ `cache`: `boolean`; `functionId`: `string`; `result`: `string`; `role`: `"function"`; \}\> \| `Readonly`\<\{ `cache`: `boolean`; `content`: `string`; `role`: `"system"`; \} \| \{ `content`: `string` \| (\{ `cache`: ... \| ... \| ...; `text`: `string`; `type`: `"text"`; \} \| \{ `cache`: ... \| ... \| ...; `details`: ... \| ... \| ... \| ...; `image`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `cache`: ... \| ... \| ...; `data`: `string`; `format`: ... \| ...; `type`: `"audio"`; \})[]; `name`: `string`; `role`: `"user"`; \} \| \{ `cache`: `boolean`; `content`: `string`; `functionCalls`: `object`[]; `name`: `string`; `role`: `"assistant"`; \} \| \{ `cache`: `boolean`; `functionId`: `string`; `result`: `string`; `role`: `"function"`; \}\>[]\> |
| `sessionId`? | `string` |

#### Returns

`void`

***

<a id="addResult"></a>

### addResult()

> **addResult**(`result`, `sessionId`?): `void`

Defined in: [src/ax/mem/types.ts:10](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxmemtypestsl10)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `result` | `Readonly`\<[`AxChatResponseResult`](#apidocs/typealiasaxchatresponseresult)\> |
| `sessionId`? | `string` |

#### Returns

`void`

***

<a id="getLast"></a>

### getLast()

> **getLast**(`sessionId`?): `undefined` \| `Readonly`\<\{ `cache`: `boolean`; `content`: `string`; `role`: `"system"`; \} \| \{ `content`: `string` \| (\{ `cache`: `boolean`; `text`: `string`; `type`: `"text"`; \} \| \{ `cache`: `boolean`; `details`: `"high"` \| `"low"` \| `"auto"`; `image`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `cache`: `boolean`; `data`: `string`; `format`: `"wav"`; `type`: `"audio"`; \})[]; `name`: `string`; `role`: `"user"`; \} \| \{ `cache`: `boolean`; `content`: `string`; `functionCalls`: `object`[]; `name`: `string`; `role`: `"assistant"`; \} \| \{ `cache`: `boolean`; `functionId`: `string`; `result`: `string`; `role`: `"function"`; \}\>

Defined in: [src/ax/mem/types.ts:16](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxmemtypestsl16)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `sessionId`? | `string` |

#### Returns

`undefined` \| `Readonly`\<\{ `cache`: `boolean`; `content`: `string`; `role`: `"system"`; \} \| \{ `content`: `string` \| (\{ `cache`: `boolean`; `text`: `string`; `type`: `"text"`; \} \| \{ `cache`: `boolean`; `details`: `"high"` \| `"low"` \| `"auto"`; `image`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `cache`: `boolean`; `data`: `string`; `format`: `"wav"`; `type`: `"audio"`; \})[]; `name`: `string`; `role`: `"user"`; \} \| \{ `cache`: `boolean`; `content`: `string`; `functionCalls`: `object`[]; `name`: `string`; `role`: `"assistant"`; \} \| \{ `cache`: `boolean`; `functionId`: `string`; `result`: `string`; `role`: `"function"`; \}\>

***

<a id="history"></a>

### history()

> **history**(`sessionId`?): `Readonly`\<\{ `cache`: `boolean`; `content`: `string`; `role`: `"system"`; \} \| \{ `content`: `string` \| (\{ `cache`: `boolean`; `text`: `string`; `type`: `"text"`; \} \| \{ `cache`: `boolean`; `details`: `"high"` \| `"low"` \| `"auto"`; `image`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `cache`: `boolean`; `data`: `string`; `format`: `"wav"`; `type`: `"audio"`; \})[]; `name`: `string`; `role`: `"user"`; \} \| \{ `cache`: `boolean`; `content`: `string`; `functionCalls`: `object`[]; `name`: `string`; `role`: `"assistant"`; \} \| \{ `cache`: `boolean`; `functionId`: `string`; `result`: `string`; `role`: `"function"`; \}\>[]

Defined in: [src/ax/mem/types.ts:13](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxmemtypestsl13)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `sessionId`? | `string` |

#### Returns

`Readonly`\<\{ `cache`: `boolean`; `content`: `string`; `role`: `"system"`; \} \| \{ `content`: `string` \| (\{ `cache`: `boolean`; `text`: `string`; `type`: `"text"`; \} \| \{ `cache`: `boolean`; `details`: `"high"` \| `"low"` \| `"auto"`; `image`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `cache`: `boolean`; `data`: `string`; `format`: `"wav"`; `type`: `"audio"`; \})[]; `name`: `string`; `role`: `"user"`; \} \| \{ `cache`: `boolean`; `content`: `string`; `functionCalls`: `object`[]; `name`: `string`; `role`: `"assistant"`; \} \| \{ `cache`: `boolean`; `functionId`: `string`; `result`: `string`; `role`: `"function"`; \}\>[]

***

<a id="reset"></a>

### reset()

> **reset**(`sessionId`?): `void`

Defined in: [src/ax/mem/types.ts:14](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxmemtypestsl14)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `sessionId`? | `string` |

#### Returns

`void`

***

<a id="updateResult"></a>

### updateResult()

> **updateResult**(`result`, `sessionId`?): `void`

Defined in: [src/ax/mem/types.ts:11](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxmemtypestsl11)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `result` | `Readonly`\<[`AxChatResponseResult`](#apidocs/typealiasaxchatresponseresult)\> |
| `sessionId`? | `string` |

#### Returns

`void`
