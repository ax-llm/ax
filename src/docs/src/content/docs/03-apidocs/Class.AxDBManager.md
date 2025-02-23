---
title: AxDBManager
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/docs/manager.ts#L33

## Constructors

<a id="constructors"></a>

### new AxDBManager()

> **new AxDBManager**(`__namedParameters`): [`AxDBManager`](/api/#03-apidocs/classaxdbmanager)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/docs/manager.ts#L40

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `__namedParameters` | `Readonly`\<[`AxDBManagerArgs`](/api/#03-apidocs/interfaceaxdbmanagerargs)\> |

#### Returns

[`AxDBManager`](/api/#03-apidocs/classaxdbmanager)

## Methods

<a id="insert"></a>

### insert()

> **insert**(`text`, `options`?): `Promise`\<`void`\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/docs/manager.ts#L53

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `text` | `Readonly`\<`string` \| `string`[]\> |
| `options`? | `Readonly`\<\{ `batchSize`: `number`; `maxWordsPerChunk`: `number`; `minWordsPerChunk`: `number`; \}\> |

#### Returns

`Promise`\<`void`\>

***

<a id="query"></a>

### query()

> **query**(`query`, `__namedParameters`): `Promise`\<[`AxDBMatch`](/api/#03-apidocs/interfaceaxdbmatch)[][]\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/docs/manager.ts#L109

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `query` | `Readonly`\<`string` \| `number` \| `string`[] \| `number`[]\> |
| `__namedParameters` | `undefined` \| `Readonly`\<\{ `topPercent`: `number`; \}\> |

#### Returns

`Promise`\<[`AxDBMatch`](/api/#03-apidocs/interfaceaxdbmatch)[][]\>
