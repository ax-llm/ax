---
title: AxDBPinecone
---

Defined in: [src/ax/db/pinecone.ts:58](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbpineconetsl58)

Pinecone: DB Service

## Extends

- [`AxDBBase`](#apidocs/classaxdbbase)

## Constructors

<a id="Constructors"></a>

### new AxDBPinecone()

> **new AxDBPinecone**(`__namedParameters`): [`AxDBPinecone`](#apidocs/classaxdbpinecone)

Defined in: [src/ax/db/pinecone.ts:62](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbpineconetsl62)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `__namedParameters` | `Readonly`\<`Omit`\<[`AxDBPineconeArgs`](#apidocs/interfaceaxdbpineconeargs), `"name"`\>\> |

#### Returns

[`AxDBPinecone`](#apidocs/classaxdbpinecone)

#### Overrides

[`AxDBBase`](#apidocs/classaxdbbase).[`constructor`](#apidocs/classaxdbbasemdconstructors)

## Properties

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

<a id="_batchUpsert"></a>

### \_batchUpsert()

> **\_batchUpsert**(`batchReq`, `_update`?, `options`?): `Promise`\<[`AxDBUpsertResponse`](#apidocs/typealiasaxdbupsertresponse)\>

Defined in: [src/ax/db/pinecone.ts:85](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbpineconetsl85)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `batchReq` | readonly [`AxDBUpsertRequest`](#apidocs/typealiasaxdbupsertrequest)[] |
| `_update`? | `boolean` |
| `options`? | `Readonly`\<[`AxDBBaseOpOptions`](#apidocs/interfaceaxdbbaseopoptions)\> |

#### Returns

`Promise`\<[`AxDBUpsertResponse`](#apidocs/typealiasaxdbupsertresponse)\>

#### Overrides

`AxDBBase._batchUpsert`

***

<a id="_upsert"></a>

### \_upsert()

> **\_upsert**(`req`, `update`?, `options`?): `Promise`\<[`AxDBUpsertResponse`](#apidocs/typealiasaxdbupsertresponse)\>

Defined in: [src/ax/db/pinecone.ts:76](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbpineconetsl76)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxDBUpsertRequest`](#apidocs/typealiasaxdbupsertrequest)\> |
| `update`? | `boolean` |
| `options`? | `Readonly`\<[`AxDBBaseOpOptions`](#apidocs/interfaceaxdbbaseopoptions)\> |

#### Returns

`Promise`\<[`AxDBUpsertResponse`](#apidocs/typealiasaxdbupsertresponse)\>

#### Overrides

`AxDBBase._upsert`

***

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

#### Inherited from

[`AxDBBase`](#apidocs/classaxdbbase).[`batchUpsert`](#apidocs/classaxdbbasemdbatchupsert)

***

<a id="query"></a>

### query()

> **query**(`req`, `options`?): `Promise`\<[`AxDBQueryResponse`](#apidocs/typealiasaxdbqueryresponse)\>

Defined in: [src/ax/db/pinecone.ts:111](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbpineconetsl111)

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
