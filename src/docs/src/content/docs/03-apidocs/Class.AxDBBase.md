---
title: AxDBBase
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/db/base.ts#L22

## Extended by

- [`AxDBCloudflare`](/api/#03-apidocs/classaxdbcloudflare)
- [`AxDBMemory`](/api/#03-apidocs/classaxdbmemory)
- [`AxDBPinecone`](/api/#03-apidocs/classaxdbpinecone)
- [`AxDBWeaviate`](/api/#03-apidocs/classaxdbweaviate)

## Implements

- [`AxDBService`](/api/#03-apidocs/interfaceaxdbservice)

## Constructors

<a id="constructors"></a>

### new AxDBBase()

```ts
new AxDBBase(__namedParameters: Readonly<AxDBBaseArgs & object>): AxDBBase
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/db/base.ts#L44

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `__namedParameters` | `Readonly`\<[`AxDBBaseArgs`](/api/#03-apidocs/interfaceaxdbbaseargs) & `object`\> |

#### Returns

[`AxDBBase`](/api/#03-apidocs/classaxdbbase)

## Properties

| Property | Type |
| :------ | :------ |
| <a id="_batchUpsert"></a> `_batchUpsert?` | (`batchReq`: readonly [`AxDBUpsertRequest`](/api/#03-apidocs/typealiasaxdbupsertrequest)[], `update`?: `boolean`, `options`?: `Readonly`\<[`AxDBBaseOpOptions`](/api/#03-apidocs/interfaceaxdbbaseopoptions)\>) => `Promise`\<[`AxDBUpsertResponse`](/api/#03-apidocs/typealiasaxdbupsertresponse)\> |
| <a id="_query"></a> `_query?` | (`req`: `Readonly`\<[`AxDBQueryRequest`](/api/#03-apidocs/typealiasaxdbqueryrequest)\>, `options`?: `Readonly`\<[`AxDBBaseOpOptions`](/api/#03-apidocs/interfaceaxdbbaseopoptions)\>) => `Promise`\<[`AxDBQueryResponse`](/api/#03-apidocs/typealiasaxdbqueryresponse)\> |
| <a id="_upsert"></a> `_upsert?` | (`req`: `Readonly`\<[`AxDBUpsertRequest`](/api/#03-apidocs/typealiasaxdbupsertrequest)\>, `update`?: `boolean`, `options`?: `Readonly`\<[`AxDBBaseOpOptions`](/api/#03-apidocs/interfaceaxdbbaseopoptions)\>) => `Promise`\<[`AxDBUpsertResponse`](/api/#03-apidocs/typealiasaxdbupsertresponse)\> |

## Methods

<a id="batchUpsert"></a>

### batchUpsert()

```ts
batchUpsert(req: readonly AxDBUpsertRequest[], update?: boolean): Promise<AxDBUpsertResponse>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/db/base.ts#L88

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `req` | readonly [`AxDBUpsertRequest`](/api/#03-apidocs/typealiasaxdbupsertrequest)[] |
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

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/db/base.ts#L128

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

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/db/base.ts#L54

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `req` | `Readonly`\<[`AxDBUpsertRequest`](/api/#03-apidocs/typealiasaxdbupsertrequest)\> |
| `update`? | `boolean` |

#### Returns

`Promise`\<[`AxDBUpsertResponse`](/api/#03-apidocs/typealiasaxdbupsertresponse)\>

#### Implementation of

[`AxDBService`](/api/#03-apidocs/interfaceaxdbservice).[`upsert`](/api/#03-apidocs/interfaceaxdbservicemdupsert)
