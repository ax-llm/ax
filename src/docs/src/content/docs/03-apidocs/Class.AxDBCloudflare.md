---
title: AxDBCloudflare
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/db/cloudflare.ts#L44

Cloudflare: DB Service

## Extends

- [`AxDBBase`](/api/#03-apidocs/classaxdbbase)

## Constructors

<a id="constructors"></a>

### new AxDBCloudflare()

```ts
new AxDBCloudflare(__namedParameters: Readonly<Omit<AxDBCloudflareArgs, "name">>): AxDBCloudflare
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/db/cloudflare.ts#L48

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `__namedParameters` | `Readonly`\<`Omit`\<[`AxDBCloudflareArgs`](/api/#03-apidocs/interfaceaxdbcloudflareargs), `"name"`\>\> |

#### Returns

[`AxDBCloudflare`](/api/#03-apidocs/classaxdbcloudflare)

#### Overrides

[`AxDBBase`](/api/#03-apidocs/classaxdbbase).[`constructor`](/api/#03-apidocs/classaxdbbasemdconstructors)

## Properties

| Property | Type | Inherited from |
| :------ | :------ | :------ |
| <a id="_batchUpsert"></a> `_batchUpsert?` | (`batchReq`: readonly [`AxDBUpsertRequest`](/api/#03-apidocs/typealiasaxdbupsertrequest)[], `update`?: `boolean`, `options`?: `Readonly`\<[`AxDBBaseOpOptions`](/api/#03-apidocs/interfaceaxdbbaseopoptions)\>) => `Promise`\<[`AxDBUpsertResponse`](/api/#03-apidocs/typealiasaxdbupsertresponse)\> | [`AxDBBase`](/api/#03-apidocs/classaxdbbase).[`_batchUpsert`](/api/#03-apidocs/classaxdbbasemdbatchupsert) |
| <a id="_query"></a> `_query?` | (`req`: `Readonly`\<[`AxDBQueryRequest`](/api/#03-apidocs/typealiasaxdbqueryrequest)\>, `options`?: `Readonly`\<[`AxDBBaseOpOptions`](/api/#03-apidocs/interfaceaxdbbaseopoptions)\>) => `Promise`\<[`AxDBQueryResponse`](/api/#03-apidocs/typealiasaxdbqueryresponse)\> | [`AxDBBase`](/api/#03-apidocs/classaxdbbase).[`_query`](/api/#03-apidocs/classaxdbbasemdquery) |

## Methods

<a id="_upsert"></a>

### \_upsert()

```ts
_upsert(
   req: Readonly<AxDBUpsertRequest>, 
   _update?: boolean, 
options?: Readonly<AxDBBaseOpOptions>): Promise<AxDBUpsertResponse>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/db/cloudflare.ts#L62

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `req` | `Readonly`\<[`AxDBUpsertRequest`](/api/#03-apidocs/typealiasaxdbupsertrequest)\> |
| `_update`? | `boolean` |
| `options`? | `Readonly`\<[`AxDBBaseOpOptions`](/api/#03-apidocs/interfaceaxdbbaseopoptions)\> |

#### Returns

`Promise`\<[`AxDBUpsertResponse`](/api/#03-apidocs/typealiasaxdbupsertresponse)\>

#### Overrides

```ts
AxDBBase._upsert
```

***

<a id="batchUpsert"></a>

### batchUpsert()

```ts
batchUpsert(
   batchReq: readonly AxDBUpsertRequest[], 
   update?: boolean, 
options?: Readonly<AxDBBaseOpOptions>): Promise<AxDBUpsertResponse>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/db/cloudflare.ts#L98

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `batchReq` | readonly [`AxDBUpsertRequest`](/api/#03-apidocs/typealiasaxdbupsertrequest)[] |
| `update`? | `boolean` |
| `options`? | `Readonly`\<[`AxDBBaseOpOptions`](/api/#03-apidocs/interfaceaxdbbaseopoptions)\> |

#### Returns

`Promise`\<[`AxDBUpsertResponse`](/api/#03-apidocs/typealiasaxdbupsertresponse)\>

#### Overrides

[`AxDBBase`](/api/#03-apidocs/classaxdbbase).[`batchUpsert`](/api/#03-apidocs/classaxdbbasemdbatchupsert)

***

<a id="query"></a>

### query()

```ts
query(req: Readonly<AxDBQueryRequest>, options?: Readonly<AxDBBaseOpOptions>): Promise<AxDBQueryResponse>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/db/cloudflare.ts#L147

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `req` | `Readonly`\<[`AxDBQueryRequest`](/api/#03-apidocs/typealiasaxdbqueryrequest)\> |
| `options`? | `Readonly`\<[`AxDBBaseOpOptions`](/api/#03-apidocs/interfaceaxdbbaseopoptions)\> |

#### Returns

`Promise`\<[`AxDBQueryResponse`](/api/#03-apidocs/typealiasaxdbqueryresponse)\>

#### Overrides

[`AxDBBase`](/api/#03-apidocs/classaxdbbase).[`query`](/api/#03-apidocs/classaxdbbasemdquery)

***

<a id="upsert"></a>

### upsert()

```ts
upsert(req: Readonly<AxDBUpsertRequest>, update?: boolean): Promise<AxDBUpsertResponse>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/db/base.ts#L54

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `req` | `Readonly`\<[`AxDBUpsertRequest`](/api/#03-apidocs/typealiasaxdbupsertrequest)\> |
| `update`? | `boolean` |

#### Returns

`Promise`\<[`AxDBUpsertResponse`](/api/#03-apidocs/typealiasaxdbupsertresponse)\>

#### Inherited from

[`AxDBBase`](/api/#03-apidocs/classaxdbbase).[`upsert`](/api/#03-apidocs/classaxdbbasemdupsert)
