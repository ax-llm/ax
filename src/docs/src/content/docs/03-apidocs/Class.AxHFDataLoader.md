---
title: AxHFDataLoader
---

Defined in: [src/ax/dsp/loader.ts:5](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdsploadertsl5)

## Constructors

<a id="Constructors"></a>

### new AxHFDataLoader()

> **new AxHFDataLoader**(`__namedParameters`): [`AxHFDataLoader`](#apidocs/classaxhfdataloader)

Defined in: [src/ax/dsp/loader.ts:14](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdsploadertsl14)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `__namedParameters` | `Readonly`\<\{ `config`: `string`; `dataset`: `string`; `options`: `Readonly`\<\{ `length`: `number`; `offset`: `number`; \}\>; `split`: `string`; \}\> |

#### Returns

[`AxHFDataLoader`](#apidocs/classaxhfdataloader)

## Methods

<a id="getData"></a>

### getData()

> **getData**(): [`AxDataRow`](#apidocs/typealiasaxdatarow)[]

Defined in: [src/ax/dsp/loader.ts:67](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdsploadertsl67)

#### Returns

[`AxDataRow`](#apidocs/typealiasaxdatarow)[]

***

<a id="getRows"></a>

### getRows()

> **getRows**\<`T`\>(`__namedParameters`): `Promise`\<`T`[]\>

Defined in: [src/ax/dsp/loader.ts:71](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdsploadertsl71)

#### Type Parameters

| Type Parameter |
| ------ |
| `T` |

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `__namedParameters` | `Readonly`\<\{ `count`: `number`; `fields`: readonly `string`[]; `renameMap`: `Record`\<`string`, `string`\>; \}\> |

#### Returns

`Promise`\<`T`[]\>

***

<a id="loadData"></a>

### loadData()

> **loadData**(): `Promise`\<[`AxDataRow`](#apidocs/typealiasaxdatarow)[]\>

Defined in: [src/ax/dsp/loader.ts:51](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdsploadertsl51)

#### Returns

`Promise`\<[`AxDataRow`](#apidocs/typealiasaxdatarow)[]\>

***

<a id="setData"></a>

### setData()

> **setData**(`rows`): `void`

Defined in: [src/ax/dsp/loader.ts:63](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdsploadertsl63)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `rows` | [`AxDataRow`](#apidocs/typealiasaxdatarow)[] |

#### Returns

`void`
