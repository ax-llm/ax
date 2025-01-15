---
title: AxApacheTika
---

Defined in: [src/ax/docs/tika.ts:12](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdocstikatsl12)

## Constructors

<a id="Constructors"></a>

### new AxApacheTika()

> **new AxApacheTika**(`args`?): [`AxApacheTika`](#apidocs/classaxapachetika)

Defined in: [src/ax/docs/tika.ts:16](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdocstikatsl16)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `args`? | `Readonly`\<[`AxApacheTikaArgs`](#apidocs/interfaceaxapachetikaargs)\> |

#### Returns

[`AxApacheTika`](#apidocs/classaxapachetika)

## Methods

<a id="convert"></a>

### convert()

> **convert**(`files`, `options`?): `Promise`\<`string`[]\>

Defined in: [src/ax/docs/tika.ts:54](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdocstikatsl54)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `files` | `Readonly`\<`string`[] \| `Blob`[]\> |
| `options`? | `Readonly`\<\{ `batchSize`: `number`; `format`: `"text"` \| `"html"`; \}\> |

#### Returns

`Promise`\<`string`[]\>
