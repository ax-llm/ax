---
title: AxDBCloudflare
---

Defined in: [src/ax/db/cloudflare.ts:44](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbcloudflaretsl44)

Cloudflare: DB Service

## Extends

- [`AxDBBase`](#apidocs/classaxdbbase)

## Constructors

<a id="Constructors"></a>

### new AxDBCloudflare()

> **new AxDBCloudflare**(`__namedParameters`): [`AxDBCloudflare`](#apidocs/classaxdbcloudflare)

Defined in: [src/ax/db/cloudflare.ts:48](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbcloudflaretsl48)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `__namedParameters` | `Readonly`\<`Omit`\<[`AxDBCloudflareArgs`](#apidocs/interfaceaxdbcloudflareargs), `"name"`\>\> |

#### Returns

[`AxDBCloudflare`](#apidocs/classaxdbcloudflare)

#### Overrides

[`AxDBBase`](#apidocs/classaxdbbase).[`constructor`](#apidocs/classaxdbbasemdconstructors)

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

#### Inherited from

[`AxDBBase`](#apidocs/classaxdbbase).[`_batchUpsert`](#apidocs/classaxdbbasemdbatchupsert)

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

#### Inherited from

[`AxDBBase`](#apidocs/classaxdbbase).[`_query`](#apidocs/classaxdbbasemdquery)

## Methods

<a id="_upsert"></a>

### \_upsert()

> **\_upsert**(`req`, `_update`?, `options`?): `Promise`\<[`AxDBUpsertResponse`](#apidocs/typealiasaxdbupsertresponse)\>

Defined in: [src/ax/db/cloudflare.ts:62](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbcloudflaretsl62)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxDBUpsertRequest`](#apidocs/typealiasaxdbupsertrequest)\> |
| `_update`? | `boolean` |
| `options`? | `Readonly`\<[`AxDBBaseOpOptions`](#apidocs/interfaceaxdbbaseopoptions)\> |

#### Returns

`Promise`\<[`AxDBUpsertResponse`](#apidocs/typealiasaxdbupsertresponse)\>

#### Overrides

`AxDBBase._upsert`

***

<a id="batchUpsert"></a>

### batchUpsert()

> **batchUpsert**(`batchReq`, `update`?, `options`?): `Promise`\<[`AxDBUpsertResponse`](#apidocs/typealiasaxdbupsertresponse)\>

Defined in: [src/ax/db/cloudflare.ts:98](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbcloudflaretsl98)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `batchReq` | readonly [`AxDBUpsertRequest`](#apidocs/typealiasaxdbupsertrequest)[] |
| `update`? | `boolean` |
| `options`? | `Readonly`\<[`AxDBBaseOpOptions`](#apidocs/interfaceaxdbbaseopoptions)\> |

#### Returns

`Promise`\<[`AxDBUpsertResponse`](#apidocs/typealiasaxdbupsertresponse)\>

#### Overrides

[`AxDBBase`](#apidocs/classaxdbbase).[`batchUpsert`](#apidocs/classaxdbbasemdbatchupsert)

***

<a id="query"></a>

### query()

> **query**(`req`, `options`?): `Promise`\<[`AxDBQueryResponse`](#apidocs/typealiasaxdbqueryresponse)\>

Defined in: [src/ax/db/cloudflare.ts:147](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbcloudflaretsl147)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxDBQueryRequest`](#apidocs/typealiasaxdbqueryrequest)\> |
| `options`? | `Readonly`\<[`AxDBBaseOpOptions`](#apidocs/interfaceaxdbbaseopoptions)\> |

#### Returns

`Promise`\<[`AxDBQueryResponse`](#apidocs/typealiasaxdbqueryresponse)\>

#### Overrides

[`AxDBBase`](#apidocs/classaxdbbase).[`query`](#apidocs/classaxdbbasemdquery)

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

#### Inherited from

[`AxDBBase`](#apidocs/classaxdbbase).[`upsert`](#apidocs/classaxdbbasemdupsert)
