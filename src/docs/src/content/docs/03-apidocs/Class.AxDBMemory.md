---
title: AxDBMemory
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/memory.ts#L20

MemoryDB: DB Service

## Extends

- [`AxDBBase`](/api/#03-apidocs/classaxdbbase)

## Constructors

<a id="constructors"></a>

### new AxDBMemory()

> **new AxDBMemory**(`__namedParameters`): [`AxDBMemory`](/api/#03-apidocs/classaxdbmemory)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/memory.ts#L23

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `__namedParameters` | `Readonly`\<`Omit`\<[`AxDBMemoryArgs`](/api/#03-apidocs/interfaceaxdbmemoryargs), `"name"`\>\> |

#### Returns

[`AxDBMemory`](/api/#03-apidocs/classaxdbmemory)

#### Overrides

[`AxDBBase`](/api/#03-apidocs/classaxdbbase).[`constructor`](/api/#03-apidocs/classaxdbbasemdconstructors)

## Methods

<a id="_batchUpsert"></a>

### \_batchUpsert()

> **\_batchUpsert**(`batchReq`, `update`?, `_options`?): `Promise`\<[`AxDBUpsertResponse`](/api/#03-apidocs/typealiasaxdbupsertresponse)\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/memory.ts#L50

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `batchReq` | readonly [`AxDBUpsertRequest`](/api/#03-apidocs/typealiasaxdbupsertrequest)[] |
| `update`? | `boolean` |
| `_options`? | `Readonly`\<[`AxDBBaseOpOptions`](/api/#03-apidocs/interfaceaxdbbaseopoptions)\> |

#### Returns

`Promise`\<[`AxDBUpsertResponse`](/api/#03-apidocs/typealiasaxdbupsertresponse)\>

#### Overrides

`AxDBBase._batchUpsert`

***

<a id="_query"></a>

### \_query()

> **\_query**(`req`, `_options`?): `Promise`\<[`AxDBQueryResponse`](/api/#03-apidocs/typealiasaxdbqueryresponse)\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/memory.ts#L65

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxDBQueryRequest`](/api/#03-apidocs/typealiasaxdbqueryrequest)\> |
| `_options`? | `Readonly`\<[`AxDBBaseOpOptions`](/api/#03-apidocs/interfaceaxdbbaseopoptions)\> |

#### Returns

`Promise`\<[`AxDBQueryResponse`](/api/#03-apidocs/typealiasaxdbqueryresponse)\>

#### Overrides

`AxDBBase._query`

***

<a id="_upsert"></a>

### \_upsert()

> **\_upsert**(`req`, `_update`?, `_options`?): `Promise`\<[`AxDBUpsertResponse`](/api/#03-apidocs/typealiasaxdbupsertresponse)\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/memory.ts#L28

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxDBUpsertRequest`](/api/#03-apidocs/typealiasaxdbupsertrequest)\> |
| `_update`? | `boolean` |
| `_options`? | `Readonly`\<[`AxDBBaseOpOptions`](/api/#03-apidocs/interfaceaxdbbaseopoptions)\> |

#### Returns

`Promise`\<[`AxDBUpsertResponse`](/api/#03-apidocs/typealiasaxdbupsertresponse)\>

#### Overrides

`AxDBBase._upsert`

***

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

#### Inherited from

[`AxDBBase`](/api/#03-apidocs/classaxdbbase).[`batchUpsert`](/api/#03-apidocs/classaxdbbasemdbatchupsert)

***

<a id="clearDB"></a>

### clearDB()

> **clearDB**(): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/memory.ts#L100

#### Returns

`void`

***

<a id="getDB"></a>

### getDB()

> **getDB**(): [`AxDBState`](/api/#03-apidocs/typealiasaxdbstate)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/memory.ts#L92

#### Returns

[`AxDBState`](/api/#03-apidocs/typealiasaxdbstate)

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

#### Inherited from

[`AxDBBase`](/api/#03-apidocs/classaxdbbase).[`query`](/api/#03-apidocs/classaxdbbasemdquery)

***

<a id="setDB"></a>

### setDB()

> **setDB**(`state`): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/memory.ts#L96

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `state` | [`AxDBState`](/api/#03-apidocs/typealiasaxdbstate) |

#### Returns

`void`

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

#### Inherited from

[`AxDBBase`](/api/#03-apidocs/classaxdbbase).[`upsert`](/api/#03-apidocs/classaxdbbasemdupsert)
