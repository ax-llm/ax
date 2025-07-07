---
title: AxDBManager
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/docs/manager.ts#L30

## Constructors

<a id="constructors"></a>

### new AxDBManager()

```ts
new AxDBManager(__namedParameters: Readonly<AxDBManagerArgs>): AxDBManager
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/docs/manager.ts#L37

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `__namedParameters` | `Readonly`\<[`AxDBManagerArgs`](/api/#03-apidocs/interfaceaxdbmanagerargs)\> |

#### Returns

[`AxDBManager`](/api/#03-apidocs/classaxdbmanager)

## Methods

<a id="insert"></a>

### insert()

```ts
insert(text: Readonly<string | string[]>, options?: Readonly<{
  abortSignal: AbortSignal;
  batchSize: number;
  maxWordsPerChunk: number;
  minWordsPerChunk: number;
}>): Promise<void>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/docs/manager.ts#L50

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `text` | `Readonly`\<`string` \| `string`[]\> |
| `options`? | `Readonly`\<\{ `abortSignal`: `AbortSignal`; `batchSize`: `number`; `maxWordsPerChunk`: `number`; `minWordsPerChunk`: `number`; \}\> |

#### Returns

`Promise`\<`void`\>

***

<a id="query"></a>

### query()

```ts
query(query: Readonly<string | number | string[] | number[]>, __namedParameters: 
  | undefined
  | Readonly<{
  abortSignal: AbortSignal;
  topPercent: number;
}>): Promise<AxDBMatch[][]>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/docs/manager.ts#L112

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `query` | `Readonly`\<`string` \| `number` \| `string`[] \| `number`[]\> |
| `__namedParameters` | \| `undefined` \| `Readonly`\<\{ `abortSignal`: `AbortSignal`; `topPercent`: `number`; \}\> |

#### Returns

`Promise`\<[`AxDBMatch`](/api/#03-apidocs/interfaceaxdbmatch)[][]\>
