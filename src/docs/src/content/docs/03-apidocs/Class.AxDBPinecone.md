---
title: AxDBPinecone
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/pinecone.ts#L58

Pinecone: DB Service

## Extends

- [`AxDBBase`](/api/#03-apidocs/classaxdbbase)

## Constructors

<a id="constructors"></a>

### new AxDBPinecone()

> **new AxDBPinecone**(`__namedParameters`): [`AxDBPinecone`](/api/#03-apidocs/classaxdbpinecone)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/pinecone.ts#L62

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `__namedParameters` | `Readonly`\<`Omit`\<[`AxDBPineconeArgs`](/api/#03-apidocs/interfaceaxdbpineconeargs), `"name"`\>\> |

#### Returns

[`AxDBPinecone`](/api/#03-apidocs/classaxdbpinecone)

#### Overrides

[`AxDBBase`](/api/#03-apidocs/classaxdbbase).[`constructor`](/api/#03-apidocs/classaxdbbasemdconstructors)

## Properties

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

#### Inherited from

[`AxDBBase`](/api/#03-apidocs/classaxdbbase).[`_query`](/api/#03-apidocs/classaxdbbasemdquery)

## Methods

<a id="_batchUpsert"></a>

### \_batchUpsert()

> **\_batchUpsert**(`batchReq`, `_update`?, `options`?): `Promise`\<[`AxDBUpsertResponse`](/api/#03-apidocs/typealiasaxdbupsertresponse)\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/pinecone.ts#L85

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `batchReq` | readonly [`AxDBUpsertRequest`](/api/#03-apidocs/typealiasaxdbupsertrequest)[] |
| `_update`? | `boolean` |
| `options`? | `Readonly`\<[`AxDBBaseOpOptions`](/api/#03-apidocs/interfaceaxdbbaseopoptions)\> |

#### Returns

`Promise`\<[`AxDBUpsertResponse`](/api/#03-apidocs/typealiasaxdbupsertresponse)\>

#### Overrides

`AxDBBase._batchUpsert`

***

<a id="_upsert"></a>

### \_upsert()

> **\_upsert**(`req`, `update`?, `options`?): `Promise`\<[`AxDBUpsertResponse`](/api/#03-apidocs/typealiasaxdbupsertresponse)\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/pinecone.ts#L76

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxDBUpsertRequest`](/api/#03-apidocs/typealiasaxdbupsertrequest)\> |
| `update`? | `boolean` |
| `options`? | `Readonly`\<[`AxDBBaseOpOptions`](/api/#03-apidocs/interfaceaxdbbaseopoptions)\> |

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

<a id="query"></a>

### query()

> **query**(`req`, `options`?): `Promise`\<[`AxDBQueryResponse`](/api/#03-apidocs/typealiasaxdbqueryresponse)\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/pinecone.ts#L111

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxDBQueryRequest`](/api/#03-apidocs/typealiasaxdbqueryrequest)\> |
| `options`? | `Readonly`\<[`AxDBBaseOpOptions`](/api/#03-apidocs/interfaceaxdbbaseopoptions)\> |

#### Returns

`Promise`\<[`AxDBQueryResponse`](/api/#03-apidocs/typealiasaxdbqueryresponse)\>

#### Overrides

[`AxDBBase`](/api/#03-apidocs/classaxdbbase).[`query`](/api/#03-apidocs/classaxdbbasemdquery)

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
