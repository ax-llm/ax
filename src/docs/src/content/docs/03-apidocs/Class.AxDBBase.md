---
title: AxDBBase
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/base.ts#L22

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

> **new AxDBBase**(`__namedParameters`): [`AxDBBase`](/api/#03-apidocs/classaxdbbase)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/base.ts#L44

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `__namedParameters` | `Readonly`\<[`AxDBBaseArgs`](/api/#03-apidocs/interfaceaxdbbaseargs) & `object`\> |

#### Returns

[`AxDBBase`](/api/#03-apidocs/classaxdbbase)

## Properties

<a id="_batchUpsert"></a>

### \_batchUpsert()?

> `optional` **\_batchUpsert**: (`batchReq`, `update`?, `options`?) => `Promise`\<[`AxDBUpsertResponse`](/api/#03-apidocs/typealiasaxdbupsertresponse)\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/base.ts#L33

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `batchReq` | readonly [`AxDBUpsertRequest`](/api/#03-apidocs/typealiasaxdbupsertrequest)[] |
| `update`? | `boolean` |
| `options`? | `Readonly`\<[`AxDBBaseOpOptions`](/api/#03-apidocs/interfaceaxdbbaseopoptions)\> |

#### Returns

`Promise`\<[`AxDBUpsertResponse`](/api/#03-apidocs/typealiasaxdbupsertresponse)\>

***

<a id="_query"></a>

### \_query()?

> `optional` **\_query**: (`req`, `options`?) => `Promise`\<[`AxDBQueryResponse`](/api/#03-apidocs/typealiasaxdbqueryresponse)\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/base.ts#L39

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxDBQueryRequest`](/api/#03-apidocs/typealiasaxdbqueryrequest)\> |
| `options`? | `Readonly`\<[`AxDBBaseOpOptions`](/api/#03-apidocs/interfaceaxdbbaseopoptions)\> |

#### Returns

`Promise`\<[`AxDBQueryResponse`](/api/#03-apidocs/typealiasaxdbqueryresponse)\>

***

<a id="_upsert"></a>

### \_upsert()?

> `optional` **\_upsert**: (`req`, `update`?, `options`?) => `Promise`\<[`AxDBUpsertResponse`](/api/#03-apidocs/typealiasaxdbupsertresponse)\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/base.ts#L27

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxDBUpsertRequest`](/api/#03-apidocs/typealiasaxdbupsertrequest)\> |
| `update`? | `boolean` |
| `options`? | `Readonly`\<[`AxDBBaseOpOptions`](/api/#03-apidocs/interfaceaxdbbaseopoptions)\> |

#### Returns

`Promise`\<[`AxDBUpsertResponse`](/api/#03-apidocs/typealiasaxdbupsertresponse)\>

## Methods

<a id="batchUpsert"></a>

### batchUpsert()

> **batchUpsert**(`req`, `update`?): `Promise`\<[`AxDBUpsertResponse`](/api/#03-apidocs/typealiasaxdbupsertresponse)\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/base.ts#L88

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | readonly [`AxDBUpsertRequest`](/api/#03-apidocs/typealiasaxdbupsertrequest)[] |
| `update`? | `boolean` |

#### Returns

`Promise`\<[`AxDBUpsertResponse`](/api/#03-apidocs/typealiasaxdbupsertresponse)\>

#### Implementation of

[`AxDBService`](/api/#03-apidocs/interfaceaxdbservice).[`batchUpsert`](/api/#03-apidocs/interfaceaxdbservicemdbatchupsert)

***

<a id="query"></a>

### query()

> **query**(`req`): `Promise`\<[`AxDBQueryResponse`](/api/#03-apidocs/typealiasaxdbqueryresponse)\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/base.ts#L128

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxDBQueryRequest`](/api/#03-apidocs/typealiasaxdbqueryrequest)\> |

#### Returns

`Promise`\<[`AxDBQueryResponse`](/api/#03-apidocs/typealiasaxdbqueryresponse)\>

#### Implementation of

[`AxDBService`](/api/#03-apidocs/interfaceaxdbservice).[`query`](/api/#03-apidocs/interfaceaxdbservicemdquery)

***

<a id="upsert"></a>

### upsert()

> **upsert**(`req`, `update`?): `Promise`\<[`AxDBUpsertResponse`](/api/#03-apidocs/typealiasaxdbupsertresponse)\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/base.ts#L54

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxDBUpsertRequest`](/api/#03-apidocs/typealiasaxdbupsertrequest)\> |
| `update`? | `boolean` |

#### Returns

`Promise`\<[`AxDBUpsertResponse`](/api/#03-apidocs/typealiasaxdbupsertresponse)\>

#### Implementation of

[`AxDBService`](/api/#03-apidocs/interfaceaxdbservice).[`upsert`](/api/#03-apidocs/interfaceaxdbservicemdupsert)
