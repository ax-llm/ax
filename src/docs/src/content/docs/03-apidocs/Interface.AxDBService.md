---
title: AxDBService
---

Defined in: [src/ax/db/types.ts:36](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbtypestsl36)

## Extends

- [`AxDBQueryService`](#apidocs/interfaceaxdbqueryservice)

## Methods

<a id="batchUpsert"></a>

### batchUpsert()

> **batchUpsert**(`batchReq`, `update`?): `Promise`\<[`AxDBUpsertResponse`](#apidocs/typealiasaxdbupsertresponse)\>

Defined in: [src/ax/db/types.ts:42](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbtypestsl42)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `batchReq` | readonly [`AxDBUpsertRequest`](#apidocs/typealiasaxdbupsertrequest)[] |
| `update`? | `boolean` |

#### Returns

`Promise`\<[`AxDBUpsertResponse`](#apidocs/typealiasaxdbupsertresponse)\>

***

<a id="query"></a>

### query()

> **query**(`req`): `Promise`\<[`AxDBQueryResponse`](#apidocs/typealiasaxdbqueryresponse)\>

Defined in: [src/ax/db/types.ts:49](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbtypestsl49)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxDBQueryRequest`](#apidocs/typealiasaxdbqueryrequest)\> |

#### Returns

`Promise`\<[`AxDBQueryResponse`](#apidocs/typealiasaxdbqueryresponse)\>

#### Inherited from

[`AxDBQueryService`](#apidocs/interfaceaxdbqueryservice).[`query`](#apidocs/interfaceaxdbqueryservicemdquery)

***

<a id="upsert"></a>

### upsert()

> **upsert**(`req`, `update`?): `Promise`\<[`AxDBUpsertResponse`](#apidocs/typealiasaxdbupsertresponse)\>

Defined in: [src/ax/db/types.ts:37](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbtypestsl37)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxDBUpsertRequest`](#apidocs/typealiasaxdbupsertrequest)\> |
| `update`? | `boolean` |

#### Returns

`Promise`\<[`AxDBUpsertResponse`](#apidocs/typealiasaxdbupsertresponse)\>
