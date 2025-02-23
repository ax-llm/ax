---
title: AxHFDataLoader
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/loader.ts#L5

## Constructors

<a id="constructors"></a>

### new AxHFDataLoader()

> **new AxHFDataLoader**(`__namedParameters`): [`AxHFDataLoader`](/api/#03-apidocs/classaxhfdataloader)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/loader.ts#L14

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `__namedParameters` | `Readonly`\<\{ `config`: `string`; `dataset`: `string`; `options`: `Readonly`\<\{ `length`: `number`; `offset`: `number`; \}\>; `split`: `string`; \}\> |

#### Returns

[`AxHFDataLoader`](/api/#03-apidocs/classaxhfdataloader)

## Methods

<a id="getData"></a>

### getData()

> **getData**(): [`AxDataRow`](/api/#03-apidocs/typealiasaxdatarow)[]

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/loader.ts#L67

#### Returns

[`AxDataRow`](/api/#03-apidocs/typealiasaxdatarow)[]

***

<a id="getRows"></a>

### getRows()

> **getRows**\<`T`\>(`__namedParameters`): `Promise`\<`T`[]\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/loader.ts#L71

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

> **loadData**(): `Promise`\<[`AxDataRow`](/api/#03-apidocs/typealiasaxdatarow)[]\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/loader.ts#L51

#### Returns

`Promise`\<[`AxDataRow`](/api/#03-apidocs/typealiasaxdatarow)[]\>

***

<a id="setData"></a>

### setData()

> **setData**(`rows`): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/loader.ts#L63

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `rows` | [`AxDataRow`](/api/#03-apidocs/typealiasaxdatarow)[] |

#### Returns

`void`
