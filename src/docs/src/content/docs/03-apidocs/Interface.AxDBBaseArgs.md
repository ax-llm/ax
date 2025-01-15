---
title: AxDBBaseArgs
---

Defined in: [src/ax/db/base.ts:13](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbbasetsl13)

## Extended by

- [`AxDBCloudflareArgs`](#apidocs/interfaceaxdbcloudflareargs)
- [`AxDBMemoryArgs`](#apidocs/interfaceaxdbmemoryargs)
- [`AxDBPineconeArgs`](#apidocs/interfaceaxdbpineconeargs)
- [`AxDBWeaviateArgs`](#apidocs/interfaceaxdbweaviateargs)

## Properties

<a id="fetch"></a>

### fetch()?

> `optional` **fetch**: (`input`, `init`?) => `Promise`\<`Response`\>

Defined in: [src/ax/db/base.ts:14](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbbasetsl14)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `input` | `string` \| `URL` \| `Request` |
| `init`? | `RequestInit` |

#### Returns

`Promise`\<`Response`\>

***

<a id="tracer"></a>

### tracer?

> `optional` **tracer**: `Tracer`

Defined in: [src/ax/db/base.ts:15](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbbasetsl15)
