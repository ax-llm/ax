---
title: AxDBMemory
---

Defined in: [src/ax/db/memory.ts:20](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbmemorytsl20)

MemoryDB: DB Service

## Extends

- [`AxDBBase`](#apidocs/classaxdbbase)

## Constructors

<a id="Constructors"></a>

### new AxDBMemory()

> **new AxDBMemory**(`__namedParameters`): [`AxDBMemory`](#apidocs/classaxdbmemory)

Defined in: [src/ax/db/memory.ts:23](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbmemorytsl23)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `__namedParameters` | `Readonly`\<`Omit`\<[`AxDBMemoryArgs`](#apidocs/interfaceaxdbmemoryargs), `"name"`\>\> |

#### Returns

[`AxDBMemory`](#apidocs/classaxdbmemory)

#### Overrides

[`AxDBBase`](#apidocs/classaxdbbase).[`constructor`](#apidocs/classaxdbbasemdconstructors)

## Methods

<a id="_batchUpsert"></a>

### \_batchUpsert()

> **\_batchUpsert**(`batchReq`, `update`?, `_options`?): `Promise`\<[`AxDBUpsertResponse`](#apidocs/typealiasaxdbupsertresponse)\>

Defined in: [src/ax/db/memory.ts:50](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbmemorytsl50)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `batchReq` | readonly [`AxDBUpsertRequest`](#apidocs/typealiasaxdbupsertrequest)[] |
| `update`? | `boolean` |
| `_options`? | `Readonly`\<[`AxDBBaseOpOptions`](#apidocs/interfaceaxdbbaseopoptions)\> |

#### Returns

`Promise`\<[`AxDBUpsertResponse`](#apidocs/typealiasaxdbupsertresponse)\>

#### Overrides

`AxDBBase._batchUpsert`

***

<a id="_query"></a>

### \_query()

> **\_query**(`req`, `_options`?): `Promise`\<[`AxDBQueryResponse`](#apidocs/typealiasaxdbqueryresponse)\>

Defined in: [src/ax/db/memory.ts:65](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbmemorytsl65)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxDBQueryRequest`](#apidocs/typealiasaxdbqueryrequest)\> |
| `_options`? | `Readonly`\<[`AxDBBaseOpOptions`](#apidocs/interfaceaxdbbaseopoptions)\> |

#### Returns

`Promise`\<[`AxDBQueryResponse`](#apidocs/typealiasaxdbqueryresponse)\>

#### Overrides

`AxDBBase._query`

***

<a id="_upsert"></a>

### \_upsert()

> **\_upsert**(`req`, `_update`?, `_options`?): `Promise`\<[`AxDBUpsertResponse`](#apidocs/typealiasaxdbupsertresponse)\>

Defined in: [src/ax/db/memory.ts:28](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbmemorytsl28)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxDBUpsertRequest`](#apidocs/typealiasaxdbupsertrequest)\> |
| `_update`? | `boolean` |
| `_options`? | `Readonly`\<[`AxDBBaseOpOptions`](#apidocs/interfaceaxdbbaseopoptions)\> |

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

<a id="clearDB"></a>

### clearDB()

> **clearDB**(): `void`

Defined in: [src/ax/db/memory.ts:100](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbmemorytsl100)

#### Returns

`void`

***

<a id="getDB"></a>

### getDB()

> **getDB**(): [`AxDBState`](#apidocs/typealiasaxdbstate)

Defined in: [src/ax/db/memory.ts:92](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbmemorytsl92)

#### Returns

[`AxDBState`](#apidocs/typealiasaxdbstate)

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

#### Inherited from

[`AxDBBase`](#apidocs/classaxdbbase).[`query`](#apidocs/classaxdbbasemdquery)

***

<a id="setDB"></a>

### setDB()

> **setDB**(`state`): `void`

Defined in: [src/ax/db/memory.ts:96](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbmemorytsl96)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `state` | [`AxDBState`](#apidocs/typealiasaxdbstate) |

#### Returns

`void`

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
