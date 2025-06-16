---
title: AxDBService
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/db/types.ts#L36

## Extends

- [`AxDBQueryService`](/api/#03-apidocs/interfaceaxdbqueryservice)

## Methods

<a id="batchUpsert"></a>

### batchUpsert()

```ts
batchUpsert(batchReq: readonly AxDBUpsertRequest[], update?: boolean): Promise<AxDBUpsertResponse>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/db/types.ts#L42

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `batchReq` | readonly [`AxDBUpsertRequest`](/api/#03-apidocs/typealiasaxdbupsertrequest)[] |
| `update`? | `boolean` |

#### Returns

`Promise`\<[`AxDBUpsertResponse`](/api/#03-apidocs/typealiasaxdbupsertresponse)\>

***

<a id="query"></a>

### query()

```ts
query(req: Readonly<AxDBQueryRequest>): Promise<AxDBQueryResponse>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/db/types.ts#L49

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `req` | `Readonly`\<[`AxDBQueryRequest`](/api/#03-apidocs/typealiasaxdbqueryrequest)\> |

#### Returns

`Promise`\<[`AxDBQueryResponse`](/api/#03-apidocs/typealiasaxdbqueryresponse)\>

#### Inherited from

[`AxDBQueryService`](/api/#03-apidocs/interfaceaxdbqueryservice).[`query`](/api/#03-apidocs/interfaceaxdbqueryservicemdquery)

***

<a id="upsert"></a>

### upsert()

```ts
upsert(req: Readonly<AxDBUpsertRequest>, update?: boolean): Promise<AxDBUpsertResponse>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/db/types.ts#L37

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `req` | `Readonly`\<[`AxDBUpsertRequest`](/api/#03-apidocs/typealiasaxdbupsertrequest)\> |
| `update`? | `boolean` |

#### Returns

`Promise`\<[`AxDBUpsertResponse`](/api/#03-apidocs/typealiasaxdbupsertresponse)\>
