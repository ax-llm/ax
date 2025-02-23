---
title: AxMemory
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/mem/memory.ts#L177

## Implements

- [`AxAIMemory`](/api/#03-apidocs/interfaceaxaimemory)

## Constructors

<a id="constructors"></a>

### new AxMemory()

> **new AxMemory**(`limit`, `debug`): [`AxMemory`](/api/#03-apidocs/classaxmemory)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/mem/memory.ts#L181

#### Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `limit` | `number` | `defaultLimit` |
| `debug` | `boolean` | `false` |

#### Returns

[`AxMemory`](/api/#03-apidocs/classaxmemory)

## Methods

<a id="add"></a>

### add()

> **add**(`value`, `sessionId`?): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/mem/memory.ts#L200

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `value` | \{ `cache`: `boolean`; `content`: `string`; `role`: `"system"`; \} \| \{ `content`: `string` \| (\{ `cache`: `boolean`; `text`: `string`; `type`: `"text"`; \} \| \{ `cache`: `boolean`; `details`: `"high"` \| `"low"` \| `"auto"`; `image`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `cache`: `boolean`; `data`: `string`; `format`: `"wav"`; `type`: `"audio"`; \})[]; `name`: `string`; `role`: `"user"`; \} \| \{ `cache`: `boolean`; `content`: `string`; `functionCalls`: `object`[]; `name`: `string`; `role`: `"assistant"`; \} \| \{ `cache`: `boolean`; `functionId`: `string`; `isError`: `boolean`; `result`: `string`; `role`: `"function"`; \} \| (\{ `cache`: `boolean`; `content`: `string`; `role`: `"system"`; \} \| \{ `content`: `string` \| (\{ `cache`: `boolean`; `text`: `string`; `type`: `"text"`; \} \| \{ `cache`: `boolean`; `details`: `"high"` \| `"low"` \| `"auto"`; `image`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `cache`: `boolean`; `data`: `string`; `format`: `"wav"`; `type`: `"audio"`; \})[]; `name`: `string`; `role`: `"user"`; \} \| \{ `cache`: `boolean`; `content`: `string`; `functionCalls`: `object`[]; `name`: `string`; `role`: `"assistant"`; \} \| \{ `cache`: `boolean`; `functionId`: `string`; `isError`: `boolean`; `result`: `string`; `role`: `"function"`; \})[] |
| `sessionId`? | `string` |

#### Returns

`void`

#### Implementation of

[`AxAIMemory`](/api/#03-apidocs/interfaceaxaimemory).[`add`](/api/#03-apidocs/interfaceaxaimemorymdadd)

***

<a id="addResult"></a>

### addResult()

> **addResult**(`result`, `sessionId`?): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/mem/memory.ts#L207

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `result` | `Readonly`\<[`AxChatResponseResult`](/api/#03-apidocs/typealiasaxchatresponseresult)\> |
| `sessionId`? | `string` |

#### Returns

`void`

#### Implementation of

[`AxAIMemory`](/api/#03-apidocs/interfaceaxaimemory).[`addResult`](/api/#03-apidocs/interfaceaxaimemorymdaddresult)

***

<a id="addTag"></a>

### addTag()

> **addTag**(`name`, `sessionId`?): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/mem/memory.ts#L218

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `name` | `string` |
| `sessionId`? | `string` |

#### Returns

`void`

#### Implementation of

[`AxAIMemory`](/api/#03-apidocs/interfaceaxaimemory).[`addTag`](/api/#03-apidocs/interfaceaxaimemorymdaddtag)

***

<a id="getLast"></a>

### getLast()

> **getLast**(`sessionId`?): `undefined` \| \{ `chat`: \{ `cache`: `boolean`; `content`: `string`; `role`: `"system"`; \} \| \{ `content`: `string` \| (\{ `cache`: `boolean`; `text`: `string`; `type`: `"text"`; \} \| \{ `cache`: `boolean`; `details`: `"high"` \| `"low"` \| `"auto"`; `image`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `cache`: `boolean`; `data`: `string`; `format`: `"wav"`; `type`: `"audio"`; \})[]; `name`: `string`; `role`: `"user"`; \} \| \{ `cache`: `boolean`; `content`: `string`; `functionCalls`: `object`[]; `name`: `string`; `role`: `"assistant"`; \} \| \{ `cache`: `boolean`; `functionId`: `string`; `isError`: `boolean`; `result`: `string`; `role`: `"function"`; \}; `tags`: `string`[]; \}

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/mem/memory.ts#L230

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `sessionId`? | `string` |

#### Returns

`undefined` \| \{ `chat`: \{ `cache`: `boolean`; `content`: `string`; `role`: `"system"`; \} \| \{ `content`: `string` \| (\{ `cache`: `boolean`; `text`: `string`; `type`: `"text"`; \} \| \{ `cache`: `boolean`; `details`: `"high"` \| `"low"` \| `"auto"`; `image`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `cache`: `boolean`; `data`: `string`; `format`: `"wav"`; `type`: `"audio"`; \})[]; `name`: `string`; `role`: `"user"`; \} \| \{ `cache`: `boolean`; `content`: `string`; `functionCalls`: `object`[]; `name`: `string`; `role`: `"assistant"`; \} \| \{ `cache`: `boolean`; `functionId`: `string`; `isError`: `boolean`; `result`: `string`; `role`: `"function"`; \}; `tags`: `string`[]; \}

#### Implementation of

[`AxAIMemory`](/api/#03-apidocs/interfaceaxaimemory).[`getLast`](/api/#03-apidocs/interfaceaxaimemorymdgetlast)

***

<a id="history"></a>

### history()

> **history**(`sessionId`?): (\{ `cache`: `boolean`; `content`: `string`; `role`: `"system"`; \} \| \{ `content`: `string` \| (\{ `cache`: `boolean`; `text`: `string`; `type`: `"text"`; \} \| \{ `cache`: `boolean`; `details`: `"high"` \| `"low"` \| `"auto"`; `image`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `cache`: `boolean`; `data`: `string`; `format`: `"wav"`; `type`: `"audio"`; \})[]; `name`: `string`; `role`: `"user"`; \} \| \{ `cache`: `boolean`; `content`: `string`; `functionCalls`: `object`[]; `name`: `string`; `role`: `"assistant"`; \} \| \{ `cache`: `boolean`; `functionId`: `string`; `isError`: `boolean`; `result`: `string`; `role`: `"function"`; \})[]

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/mem/memory.ts#L226

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `sessionId`? | `string` |

#### Returns

(\{ `cache`: `boolean`; `content`: `string`; `role`: `"system"`; \} \| \{ `content`: `string` \| (\{ `cache`: `boolean`; `text`: `string`; `type`: `"text"`; \} \| \{ `cache`: `boolean`; `details`: `"high"` \| `"low"` \| `"auto"`; `image`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `cache`: `boolean`; `data`: `string`; `format`: `"wav"`; `type`: `"audio"`; \})[]; `name`: `string`; `role`: `"user"`; \} \| \{ `cache`: `boolean`; `content`: `string`; `functionCalls`: `object`[]; `name`: `string`; `role`: `"assistant"`; \} \| \{ `cache`: `boolean`; `functionId`: `string`; `isError`: `boolean`; `result`: `string`; `role`: `"function"`; \})[]

#### Implementation of

[`AxAIMemory`](/api/#03-apidocs/interfaceaxaimemory).[`history`](/api/#03-apidocs/interfaceaxaimemorymdhistory)

***

<a id="reset"></a>

### reset()

> **reset**(`sessionId`?): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/mem/memory.ts#L234

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `sessionId`? | `string` |

#### Returns

`void`

#### Implementation of

[`AxAIMemory`](/api/#03-apidocs/interfaceaxaimemory).[`reset`](/api/#03-apidocs/interfaceaxaimemorymdreset)

***

<a id="rewindToTag"></a>

### rewindToTag()

> **rewindToTag**(`name`, `sessionId`?): (\{ `cache`: `boolean`; `content`: `string`; `role`: `"system"`; \} \| \{ `content`: `string` \| (\{ `cache`: `boolean`; `text`: `string`; `type`: `"text"`; \} \| \{ `cache`: `boolean`; `details`: `"high"` \| `"low"` \| `"auto"`; `image`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `cache`: `boolean`; `data`: `string`; `format`: `"wav"`; `type`: `"audio"`; \})[]; `name`: `string`; `role`: `"user"`; \} \| \{ `cache`: `boolean`; `content`: `string`; `functionCalls`: `object`[]; `name`: `string`; `role`: `"assistant"`; \} \| \{ `cache`: `boolean`; `functionId`: `string`; `isError`: `boolean`; `result`: `string`; `role`: `"function"`; \})[]

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/mem/memory.ts#L222

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `name` | `string` |
| `sessionId`? | `string` |

#### Returns

(\{ `cache`: `boolean`; `content`: `string`; `role`: `"system"`; \} \| \{ `content`: `string` \| (\{ `cache`: `boolean`; `text`: `string`; `type`: `"text"`; \} \| \{ `cache`: `boolean`; `details`: `"high"` \| `"low"` \| `"auto"`; `image`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `cache`: `boolean`; `data`: `string`; `format`: `"wav"`; `type`: `"audio"`; \})[]; `name`: `string`; `role`: `"user"`; \} \| \{ `cache`: `boolean`; `content`: `string`; `functionCalls`: `object`[]; `name`: `string`; `role`: `"assistant"`; \} \| \{ `cache`: `boolean`; `functionId`: `string`; `isError`: `boolean`; `result`: `string`; `role`: `"function"`; \})[]

#### Implementation of

[`AxAIMemory`](/api/#03-apidocs/interfaceaxaimemory).[`rewindToTag`](/api/#03-apidocs/interfaceaxaimemorymdrewindtotag)

***

<a id="updateResult"></a>

### updateResult()

> **updateResult**(`result`, `sessionId`?): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/mem/memory.ts#L211

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `result` | `Readonly`\<[`AxChatResponseResult`](/api/#03-apidocs/typealiasaxchatresponseresult)\> |
| `sessionId`? | `string` |

#### Returns

`void`

#### Implementation of

[`AxAIMemory`](/api/#03-apidocs/interfaceaxaimemory).[`updateResult`](/api/#03-apidocs/interfaceaxaimemorymdupdateresult)
