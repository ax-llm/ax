---
title: AxDB
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/wrap.ts#L19

## Implements

- [`AxDBService`](/api/#03-apidocs/interfaceaxdbservice)

## Constructors

<a id="constructors"></a>

### new AxDB()

> **new AxDB**(`args`): [`AxDB`](/api/#03-apidocs/classaxdb)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/wrap.ts#L21

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `args` | `Readonly`\<[`AxDBArgs`](/api/#03-apidocs/typealiasaxdbargs)\> |

#### Returns

[`AxDB`](/api/#03-apidocs/classaxdb)

## Methods

<a id="batchUpsert"></a>

### batchUpsert()

> **batchUpsert**(`batchReq`, `update`?): `Promise`\<[`AxDBUpsertResponse`](/api/#03-apidocs/typealiasaxdbupsertresponse)\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/wrap.ts#L46

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `batchReq` | readonly [`AxDBUpsertRequest`](/api/#03-apidocs/typealiasaxdbupsertrequest)[] |
| `update`? | `boolean` |

#### Returns

`Promise`\<[`AxDBUpsertResponse`](/api/#03-apidocs/typealiasaxdbupsertresponse)\>

#### Implementation of

[`AxDBService`](/api/#03-apidocs/interfaceaxdbservice).[`batchUpsert`](/api/#03-apidocs/interfaceaxdbservicemdbatchupsert)

***

<a id="query"></a>

### query()

> **query**(`req`): `Promise`\<[`AxDBQueryResponse`](/api/#03-apidocs/typealiasaxdbqueryresponse)\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/wrap.ts#L53

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

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/wrap.ts#L39

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxDBUpsertRequest`](/api/#03-apidocs/typealiasaxdbupsertrequest)\> |
| `update`? | `boolean` |

#### Returns

`Promise`\<[`AxDBUpsertResponse`](/api/#03-apidocs/typealiasaxdbupsertresponse)\>

#### Implementation of

[`AxDBService`](/api/#03-apidocs/interfaceaxdbservice).[`upsert`](/api/#03-apidocs/interfaceaxdbservicemdupsert)
