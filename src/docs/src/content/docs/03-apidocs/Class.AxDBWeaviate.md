---
title: AxDBWeaviate
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/weaviate.ts#L39

Weaviate: DB Service

## Extends

- [`AxDBBase`](/api/#03-apidocs/classaxdbbase)

## Constructors

<a id="constructors"></a>

### new AxDBWeaviate()

> **new AxDBWeaviate**(`__namedParameters`): [`AxDBWeaviate`](/api/#03-apidocs/classaxdbweaviate)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/weaviate.ts#L43

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `__namedParameters` | `Readonly`\<`Omit`\<[`AxDBWeaviateArgs`](/api/#03-apidocs/interfaceaxdbweaviateargs), `"name"`\>\> |

#### Returns

[`AxDBWeaviate`](/api/#03-apidocs/classaxdbweaviate)

#### Overrides

[`AxDBBase`](/api/#03-apidocs/classaxdbbase).[`constructor`](/api/#03-apidocs/classaxdbbasemdconstructors)

## Methods

<a id="_batchUpsert"></a>

### \_batchUpsert()

> **\_batchUpsert**(`batchReq`, `update`?, `options`?): `Promise`\<[`AxDBUpsertResponse`](/api/#03-apidocs/typealiasaxdbupsertresponse)\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/weaviate.ts#L93

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `batchReq` | readonly [`AxDBUpsertRequest`](/api/#03-apidocs/typealiasaxdbupsertrequest)[] |
| `update`? | `boolean` |
| `options`? | `Readonly`\<[`AxDBBaseOpOptions`](/api/#03-apidocs/interfaceaxdbbaseopoptions)\> |

#### Returns

`Promise`\<[`AxDBUpsertResponse`](/api/#03-apidocs/typealiasaxdbupsertresponse)\>

#### Overrides

`AxDBBase._batchUpsert`

***

<a id="_query"></a>

### \_query()

> **\_query**(`req`, `options`?): `Promise`\<[`AxDBQueryResponse`](/api/#03-apidocs/typealiasaxdbqueryresponse)\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/weaviate.ts#L138

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxDBQueryRequest`](/api/#03-apidocs/typealiasaxdbqueryrequest)\> |
| `options`? | `Readonly`\<[`AxDBBaseOpOptions`](/api/#03-apidocs/interfaceaxdbbaseopoptions)\> |

#### Returns

`Promise`\<[`AxDBQueryResponse`](/api/#03-apidocs/typealiasaxdbqueryresponse)\>

#### Overrides

`AxDBBase._query`

***

<a id="_upsert"></a>

### \_upsert()

> **\_upsert**(`req`, `update`?, `options`?): `Promise`\<[`AxDBUpsertResponse`](/api/#03-apidocs/typealiasaxdbupsertresponse)\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/weaviate.ts#L57

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
