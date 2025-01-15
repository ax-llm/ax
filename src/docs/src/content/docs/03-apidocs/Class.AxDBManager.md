---
title: AxDBManager
---

Defined in: [src/ax/docs/manager.ts:33](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdocsmanagertsl33)

## Constructors

<a id="Constructors"></a>

### new AxDBManager()

> **new AxDBManager**(`__namedParameters`): [`AxDBManager`](#apidocs/classaxdbmanager)

Defined in: [src/ax/docs/manager.ts:40](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdocsmanagertsl40)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `__namedParameters` | `Readonly`\<[`AxDBManagerArgs`](#apidocs/interfaceaxdbmanagerargs)\> |

#### Returns

[`AxDBManager`](#apidocs/classaxdbmanager)

## Methods

<a id="insert"></a>

### insert()

> **insert**(`text`, `options`?): `Promise`\<`void`\>

Defined in: [src/ax/docs/manager.ts:53](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdocsmanagertsl53)

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

> **query**(`query`, `__namedParameters`): `Promise`\<[`AxDBMatch`](#apidocs/interfaceaxdbmatch)[][]\>

Defined in: [src/ax/docs/manager.ts:109](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdocsmanagertsl109)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `query` | `Readonly`\<`string` \| `number` \| `string`[] \| `number`[]\> |
| `__namedParameters` | `undefined` \| `Readonly`\<\{ `topPercent`: `number`; \}\> |

#### Returns

`Promise`\<[`AxDBMatch`](#apidocs/interfaceaxdbmatch)[][]\>
