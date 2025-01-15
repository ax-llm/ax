---
title: AxDB
---

Defined in: [src/ax/db/wrap.ts:19](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbwraptsl19)

## Implements

- [`AxDBService`](#apidocs/interfaceaxdbservice)

## Constructors

<a id="Constructors"></a>

### new AxDB()

> **new AxDB**(`args`): [`AxDB`](#apidocs/classaxdb)

Defined in: [src/ax/db/wrap.ts:21](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbwraptsl21)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `args` | `Readonly`\<[`AxDBArgs`](#apidocs/typealiasaxdbargs)\> |

#### Returns

[`AxDB`](#apidocs/classaxdb)

## Methods

<a id="batchUpsert"></a>

### batchUpsert()

> **batchUpsert**(`batchReq`, `update`?): `Promise`\<[`AxDBUpsertResponse`](#apidocs/typealiasaxdbupsertresponse)\>

Defined in: [src/ax/db/wrap.ts:46](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbwraptsl46)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `batchReq` | readonly [`AxDBUpsertRequest`](#apidocs/typealiasaxdbupsertrequest)[] |
| `update`? | `boolean` |

#### Returns

`Promise`\<[`AxDBUpsertResponse`](#apidocs/typealiasaxdbupsertresponse)\>

#### Implementation of

[`AxDBService`](#apidocs/interfaceaxdbservice).[`batchUpsert`](#apidocs/interfaceaxdbservicemdbatchupsert)

***

<a id="query"></a>

### query()

> **query**(`req`): `Promise`\<[`AxDBQueryResponse`](#apidocs/typealiasaxdbqueryresponse)\>

Defined in: [src/ax/db/wrap.ts:53](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbwraptsl53)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxDBQueryRequest`](#apidocs/typealiasaxdbqueryrequest)\> |

#### Returns

`Promise`\<[`AxDBQueryResponse`](#apidocs/typealiasaxdbqueryresponse)\>

#### Implementation of

[`AxDBService`](#apidocs/interfaceaxdbservice).[`query`](#apidocs/interfaceaxdbservicemdquery)

***

<a id="upsert"></a>

### upsert()

> **upsert**(`req`, `update`?): `Promise`\<[`AxDBUpsertResponse`](#apidocs/typealiasaxdbupsertresponse)\>

Defined in: [src/ax/db/wrap.ts:39](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbwraptsl39)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxDBUpsertRequest`](#apidocs/typealiasaxdbupsertrequest)\> |
| `update`? | `boolean` |

#### Returns

`Promise`\<[`AxDBUpsertResponse`](#apidocs/typealiasaxdbupsertresponse)\>

#### Implementation of

[`AxDBService`](#apidocs/interfaceaxdbservice).[`upsert`](#apidocs/interfaceaxdbservicemdupsert)
