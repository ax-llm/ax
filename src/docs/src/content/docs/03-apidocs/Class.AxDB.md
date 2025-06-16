---
title: AxDB
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/db/wrap.ts#L19

## Implements

- [`AxDBService`](/api/#03-apidocs/interfaceaxdbservice)

## Constructors

<a id="constructors"></a>

### new AxDB()

```ts
new AxDB(args: Readonly<AxDBArgs>): AxDB
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/db/wrap.ts#L21

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `args` | `Readonly`\<[`AxDBArgs`](/api/#03-apidocs/typealiasaxdbargs)\> |

#### Returns

[`AxDB`](/api/#03-apidocs/classaxdb)

## Methods

<a id="batchUpsert"></a>

### batchUpsert()

```ts
batchUpsert(batchReq: readonly AxDBUpsertRequest[], update?: boolean): Promise<AxDBUpsertResponse>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/db/wrap.ts#L46

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `batchReq` | readonly [`AxDBUpsertRequest`](/api/#03-apidocs/typealiasaxdbupsertrequest)[] |
| `update`? | `boolean` |

#### Returns

`Promise`\<[`AxDBUpsertResponse`](/api/#03-apidocs/typealiasaxdbupsertresponse)\>

#### Implementation of

[`AxDBService`](/api/#03-apidocs/interfaceaxdbservice).[`batchUpsert`](/api/#03-apidocs/interfaceaxdbservicemdbatchupsert)

***

<a id="query"></a>

### query()

```ts
query(req: Readonly<AxDBQueryRequest>): Promise<AxDBQueryResponse>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/db/wrap.ts#L53

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `req` | `Readonly`\<[`AxDBQueryRequest`](/api/#03-apidocs/typealiasaxdbqueryrequest)\> |

#### Returns

`Promise`\<[`AxDBQueryResponse`](/api/#03-apidocs/typealiasaxdbqueryresponse)\>

#### Implementation of

[`AxDBService`](/api/#03-apidocs/interfaceaxdbservice).[`query`](/api/#03-apidocs/interfaceaxdbservicemdquery)

***

<a id="upsert"></a>

### upsert()

```ts
upsert(req: Readonly<AxDBUpsertRequest>, update?: boolean): Promise<AxDBUpsertResponse>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/db/wrap.ts#L39

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `req` | `Readonly`\<[`AxDBUpsertRequest`](/api/#03-apidocs/typealiasaxdbupsertrequest)\> |
| `update`? | `boolean` |

#### Returns

`Promise`\<[`AxDBUpsertResponse`](/api/#03-apidocs/typealiasaxdbupsertresponse)\>

#### Implementation of

[`AxDBService`](/api/#03-apidocs/interfaceaxdbservice).[`upsert`](/api/#03-apidocs/interfaceaxdbservicemdupsert)
