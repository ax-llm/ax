---
title: AxMemory
---

Defined in: [src/ax/mem/memory.ts:8](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxmemmemorytsl8)

## Implements

- [`AxAIMemory`](#apidocs/interfaceaxaimemory)

## Constructors

<a id="Constructors"></a>

### new AxMemory()

> **new AxMemory**(`limit`): [`AxMemory`](#apidocs/classaxmemory)

Defined in: [src/ax/mem/memory.ts:13](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxmemmemorytsl13)

#### Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `limit` | `number` | `50` |

#### Returns

[`AxMemory`](#apidocs/classaxmemory)

## Methods

<a id="add"></a>

### add()

> **add**(`value`, `sessionId`?): `void`

Defined in: [src/ax/mem/memory.ts:20](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxmemmemorytsl20)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `value` | `Readonly`\<`Readonly`\<\{ `cache`: `boolean`; `content`: `string`; `role`: `"system"`; \} \| \{ `content`: `string` \| (\{ `cache`: `boolean`; `text`: `string`; `type`: `"text"`; \} \| \{ `cache`: `boolean`; `details`: `"high"` \| `"low"` \| `"auto"`; `image`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `cache`: `boolean`; `data`: `string`; `format`: `"wav"`; `type`: `"audio"`; \})[]; `name`: `string`; `role`: `"user"`; \} \| \{ `cache`: `boolean`; `content`: `string`; `functionCalls`: `object`[]; `name`: `string`; `role`: `"assistant"`; \} \| \{ `cache`: `boolean`; `functionId`: `string`; `result`: `string`; `role`: `"function"`; \}\> \| `Readonly`\<\{ `cache`: `boolean`; `content`: `string`; `role`: `"system"`; \} \| \{ `content`: `string` \| (\{ `cache`: ... \| ... \| ...; `text`: `string`; `type`: `"text"`; \} \| \{ `cache`: ... \| ... \| ...; `details`: ... \| ... \| ... \| ...; `image`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `cache`: ... \| ... \| ...; `data`: `string`; `format`: ... \| ...; `type`: `"audio"`; \})[]; `name`: `string`; `role`: `"user"`; \} \| \{ `cache`: `boolean`; `content`: `string`; `functionCalls`: `object`[]; `name`: `string`; `role`: `"assistant"`; \} \| \{ `cache`: `boolean`; `functionId`: `string`; `result`: `string`; `role`: `"function"`; \}\>[]\> |
| `sessionId`? | `string` |

#### Returns

`void`

#### Implementation of

[`AxAIMemory`](#apidocs/interfaceaxaimemory).[`add`](#apidocs/interfaceaxaimemorymdadd)

***

<a id="addResult"></a>

### addResult()

> **addResult**(`__namedParameters`, `sessionId`?): `void`

Defined in: [src/ax/mem/memory.ts:41](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxmemmemorytsl41)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `__namedParameters` | `Readonly`\<[`AxChatResponseResult`](#apidocs/typealiasaxchatresponseresult)\> |
| `sessionId`? | `string` |

#### Returns

`void`

#### Implementation of

[`AxAIMemory`](#apidocs/interfaceaxaimemory).[`addResult`](#apidocs/interfaceaxaimemorymdaddresult)

***

<a id="getLast"></a>

### getLast()

> **getLast**(`sessionId`?): `undefined` \| `Readonly`\<\{ `cache`: `boolean`; `content`: `string`; `role`: `"system"`; \} \| \{ `content`: `string` \| (\{ `cache`: `boolean`; `text`: `string`; `type`: `"text"`; \} \| \{ `cache`: `boolean`; `details`: `"high"` \| `"low"` \| `"auto"`; `image`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `cache`: `boolean`; `data`: `string`; `format`: `"wav"`; `type`: `"audio"`; \})[]; `name`: `string`; `role`: `"user"`; \} \| \{ `cache`: `boolean`; `content`: `string`; `functionCalls`: `object`[]; `name`: `string`; `role`: `"assistant"`; \} \| \{ `cache`: `boolean`; `functionId`: `string`; `result`: `string`; `role`: `"function"`; \}\>

Defined in: [src/ax/mem/memory.ts:79](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxmemmemorytsl79)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `sessionId`? | `string` |

#### Returns

`undefined` \| `Readonly`\<\{ `cache`: `boolean`; `content`: `string`; `role`: `"system"`; \} \| \{ `content`: `string` \| (\{ `cache`: `boolean`; `text`: `string`; `type`: `"text"`; \} \| \{ `cache`: `boolean`; `details`: `"high"` \| `"low"` \| `"auto"`; `image`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `cache`: `boolean`; `data`: `string`; `format`: `"wav"`; `type`: `"audio"`; \})[]; `name`: `string`; `role`: `"user"`; \} \| \{ `cache`: `boolean`; `content`: `string`; `functionCalls`: `object`[]; `name`: `string`; `role`: `"assistant"`; \} \| \{ `cache`: `boolean`; `functionId`: `string`; `result`: `string`; `role`: `"function"`; \}\>

#### Implementation of

[`AxAIMemory`](#apidocs/interfaceaxaimemory).[`getLast`](#apidocs/interfaceaxaimemorymdgetlast)

***

<a id="history"></a>

### history()

> **history**(`sessionId`?): `Readonly`\<\{ `cache`: `boolean`; `content`: `string`; `role`: `"system"`; \} \| \{ `content`: `string` \| (\{ `cache`: `boolean`; `text`: `string`; `type`: `"text"`; \} \| \{ `cache`: `boolean`; `details`: `"high"` \| `"low"` \| `"auto"`; `image`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `cache`: `boolean`; `data`: `string`; `format`: `"wav"`; `type`: `"audio"`; \})[]; `name`: `string`; `role`: `"user"`; \} \| \{ `cache`: `boolean`; `content`: `string`; `functionCalls`: `object`[]; `name`: `string`; `role`: `"assistant"`; \} \| \{ `cache`: `boolean`; `functionId`: `string`; `result`: `string`; `role`: `"function"`; \}\>[]

Defined in: [src/ax/mem/memory.ts:75](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxmemmemorytsl75)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `sessionId`? | `string` |

#### Returns

`Readonly`\<\{ `cache`: `boolean`; `content`: `string`; `role`: `"system"`; \} \| \{ `content`: `string` \| (\{ `cache`: `boolean`; `text`: `string`; `type`: `"text"`; \} \| \{ `cache`: `boolean`; `details`: `"high"` \| `"low"` \| `"auto"`; `image`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `cache`: `boolean`; `data`: `string`; `format`: `"wav"`; `type`: `"audio"`; \})[]; `name`: `string`; `role`: `"user"`; \} \| \{ `cache`: `boolean`; `content`: `string`; `functionCalls`: `object`[]; `name`: `string`; `role`: `"assistant"`; \} \| \{ `cache`: `boolean`; `functionId`: `string`; `result`: `string`; `role`: `"function"`; \}\>[]

#### Implementation of

[`AxAIMemory`](#apidocs/interfaceaxaimemory).[`history`](#apidocs/interfaceaxaimemorymdhistory)

***

<a id="reset"></a>

### reset()

> **reset**(`sessionId`?): `void`

Defined in: [src/ax/mem/memory.ts:84](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxmemmemorytsl84)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `sessionId`? | `string` |

#### Returns

`void`

#### Implementation of

[`AxAIMemory`](#apidocs/interfaceaxaimemory).[`reset`](#apidocs/interfaceaxaimemorymdreset)

***

<a id="updateResult"></a>

### updateResult()

> **updateResult**(`__namedParameters`, `sessionId`?): `void`

Defined in: [src/ax/mem/memory.ts:51](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxmemmemorytsl51)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `__namedParameters` | `Readonly`\<[`AxChatResponseResult`](#apidocs/typealiasaxchatresponseresult)\> |
| `sessionId`? | `string` |

#### Returns

`void`

#### Implementation of

[`AxAIMemory`](#apidocs/interfaceaxaimemory).[`updateResult`](#apidocs/interfaceaxaimemorymdupdateresult)
