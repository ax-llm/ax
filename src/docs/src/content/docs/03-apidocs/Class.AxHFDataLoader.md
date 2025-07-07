---
title: AxHFDataLoader
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/loader.ts#L5

## Constructors

<a id="constructors"></a>

### new AxHFDataLoader()

```ts
new AxHFDataLoader(__namedParameters: Readonly<{
  config: string;
  dataset: string;
  options: Readonly<{
     length: number;
     offset: number;
    }>;
  split: string;
 }>): AxHFDataLoader
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/loader.ts#L14

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `__namedParameters` | `Readonly`\<\{ `config`: `string`; `dataset`: `string`; `options`: `Readonly`\<\{ `length`: `number`; `offset`: `number`; \}\>; `split`: `string`; \}\> |

#### Returns

[`AxHFDataLoader`](/api/#03-apidocs/classaxhfdataloader)

## Methods

<a id="getData"></a>

### getData()

```ts
getData(): AxDataRow[]
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/loader.ts#L67

#### Returns

[`AxDataRow`](/api/#03-apidocs/typealiasaxdatarow)[]

***

<a id="getRows"></a>

### getRows()

```ts
getRows<T>(__namedParameters: Readonly<{
  count: number;
  fields: readonly string[];
  renameMap: Record<string, string>;
}>): Promise<T[]>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/loader.ts#L71

#### Type Parameters

| Type Parameter |
| :------ |
| `T` |

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `__namedParameters` | `Readonly`\<\{ `count`: `number`; `fields`: readonly `string`[]; `renameMap`: `Record`\<`string`, `string`\>; \}\> |

#### Returns

`Promise`\<`T`[]\>

***

<a id="loadData"></a>

### loadData()

```ts
loadData(): Promise<AxDataRow[]>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/loader.ts#L51

#### Returns

`Promise`\<[`AxDataRow`](/api/#03-apidocs/typealiasaxdatarow)[]\>

***

<a id="setData"></a>

### setData()

```ts
setData(rows: AxDataRow[]): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/loader.ts#L63

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `rows` | [`AxDataRow`](/api/#03-apidocs/typealiasaxdatarow)[] |

#### Returns

`void`
