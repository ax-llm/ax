---
title: AxApacheTika
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/docs/tika.ts#L12

## Constructors

<a id="constructors"></a>

### new AxApacheTika()

```ts
new AxApacheTika(args?: Readonly<AxApacheTikaArgs>): AxApacheTika
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/docs/tika.ts#L16

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `args`? | `Readonly`\<[`AxApacheTikaArgs`](/api/#03-apidocs/interfaceaxapachetikaargs)\> |

#### Returns

[`AxApacheTika`](/api/#03-apidocs/classaxapachetika)

## Methods

<a id="convert"></a>

### convert()

```ts
convert(files: Readonly<string[] | Blob[]>, options?: Readonly<{
  batchSize: number;
  format: "text" | "html";
}>): Promise<string[]>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/docs/tika.ts#L54

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `files` | `Readonly`\<`string`[] \| `Blob`[]\> |
| `options`? | `Readonly`\<\{ `batchSize`: `number`; `format`: `"text"` \| `"html"`; \}\> |

#### Returns

`Promise`\<`string`[]\>
