---
title: AxApacheTika
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/docs/tika.ts#L12

## Constructors

<a id="constructors"></a>

### new AxApacheTika()

> **new AxApacheTika**(`args`?): [`AxApacheTika`](/api/#03-apidocs/classaxapachetika)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/docs/tika.ts#L16

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `args`? | `Readonly`\<[`AxApacheTikaArgs`](/api/#03-apidocs/interfaceaxapachetikaargs)\> |

#### Returns

[`AxApacheTika`](/api/#03-apidocs/classaxapachetika)

## Methods

<a id="convert"></a>

### convert()

> **convert**(`files`, `options`?): `Promise`\<`string`[]\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/docs/tika.ts#L54

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `files` | `Readonly`\<`string`[] \| `Blob`[]\> |
| `options`? | `Readonly`\<\{ `batchSize`: `number`; `format`: `"text"` \| `"html"`; \}\> |

#### Returns

`Promise`\<`string`[]\>
