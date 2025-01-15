---
title: AxDBBase
---

Defined in: [src/ax/db/base.ts:22](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbbasetsl22)

## Extended by

- [`AxDBCloudflare`](#apidocs/classaxdbcloudflare)
- [`AxDBMemory`](#apidocs/classaxdbmemory)
- [`AxDBPinecone`](#apidocs/classaxdbpinecone)
- [`AxDBWeaviate`](#apidocs/classaxdbweaviate)

## Implements

- [`AxDBService`](#apidocs/interfaceaxdbservice)

## Constructors

<a id="Constructors"></a>

### new AxDBBase()

> **new AxDBBase**(`__namedParameters`): [`AxDBBase`](#apidocs/classaxdbbase)

Defined in: [src/ax/db/base.ts:44](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbbasetsl44)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `__namedParameters` | `Readonly`\<[`AxDBBaseArgs`](#apidocs/interfaceaxdbbaseargs) & `object`\> |

#### Returns

[`AxDBBase`](#apidocs/classaxdbbase)

## Properties

<a id="_batchUpsert"></a>

### \_batchUpsert()?

> `optional` **\_batchUpsert**: (`batchReq`, `update`?, `options`?) => `Promise`\<[`AxDBUpsertResponse`](#apidocs/typealiasaxdbupsertresponse)\>

Defined in: [src/ax/db/base.ts:33](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbbasetsl33)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `batchReq` | readonly [`AxDBUpsertRequest`](#apidocs/typealiasaxdbupsertrequest)[] |
| `update`? | `boolean` |
| `options`? | `Readonly`\<[`AxDBBaseOpOptions`](#apidocs/interfaceaxdbbaseopoptions)\> |

#### Returns

`Promise`\<[`AxDBUpsertResponse`](#apidocs/typealiasaxdbupsertresponse)\>

***

<a id="_query"></a>

### \_query()?

> `optional` **\_query**: (`req`, `options`?) => `Promise`\<[`AxDBQueryResponse`](#apidocs/typealiasaxdbqueryresponse)\>

Defined in: [src/ax/db/base.ts:39](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbbasetsl39)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxDBQueryRequest`](#apidocs/typealiasaxdbqueryrequest)\> |
| `options`? | `Readonly`\<[`AxDBBaseOpOptions`](#apidocs/interfaceaxdbbaseopoptions)\> |

#### Returns

`Promise`\<[`AxDBQueryResponse`](#apidocs/typealiasaxdbqueryresponse)\>

***

<a id="_upsert"></a>

### \_upsert()?

> `optional` **\_upsert**: (`req`, `update`?, `options`?) => `Promise`\<[`AxDBUpsertResponse`](#apidocs/typealiasaxdbupsertresponse)\>

Defined in: [src/ax/db/base.ts:27](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbbasetsl27)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxDBUpsertRequest`](#apidocs/typealiasaxdbupsertrequest)\> |
| `update`? | `boolean` |
| `options`? | `Readonly`\<[`AxDBBaseOpOptions`](#apidocs/interfaceaxdbbaseopoptions)\> |

#### Returns

`Promise`\<[`AxDBUpsertResponse`](#apidocs/typealiasaxdbupsertresponse)\>

## Methods

<a id="batchUpsert"></a>

### batchUpsert()

> **batchUpsert**(`req`, `update`?): `Promise`\<[`AxDBUpsertResponse`](#apidocs/typealiasaxdbupsertresponse)\>

Defined in: [src/ax/db/base.ts:86](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbbasetsl86)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | readonly [`AxDBUpsertRequest`](#apidocs/typealiasaxdbupsertrequest)[] |
| `update`? | `boolean` |

#### Returns

`Promise`\<[`AxDBUpsertResponse`](#apidocs/typealiasaxdbupsertresponse)\>

#### Implementation of

[`AxDBService`](#apidocs/interfaceaxdbservice).[`batchUpsert`](#apidocs/interfaceaxdbservicemdbatchupsert)

***

<a id="query"></a>

### query()

> **query**(`req`): `Promise`\<[`AxDBQueryResponse`](#apidocs/typealiasaxdbqueryresponse)\>

Defined in: [src/ax/db/base.ts:124](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbbasetsl124)

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

Defined in: [src/ax/db/base.ts:54](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbbasetsl54)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxDBUpsertRequest`](#apidocs/typealiasaxdbupsertrequest)\> |
| `update`? | `boolean` |

#### Returns

`Promise`\<[`AxDBUpsertResponse`](#apidocs/typealiasaxdbupsertresponse)\>

#### Implementation of

[`AxDBService`](#apidocs/interfaceaxdbservice).[`upsert`](#apidocs/interfaceaxdbservicemdupsert)
