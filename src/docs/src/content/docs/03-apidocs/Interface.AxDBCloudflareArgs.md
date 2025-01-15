---
title: AxDBCloudflareArgs
---

Defined in: [src/ax/db/cloudflare.ts:34](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbcloudflaretsl34)

## Extends

- [`AxDBBaseArgs`](#apidocs/interfaceaxdbbaseargs)

## Properties

<a id="accountId"></a>

### accountId

> **accountId**: `string`

Defined in: [src/ax/db/cloudflare.ts:37](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbcloudflaretsl37)

***

<a id="apiKey"></a>

### apiKey

> **apiKey**: `string`

Defined in: [src/ax/db/cloudflare.ts:36](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbcloudflaretsl36)

***

<a id="fetch"></a>

### fetch()?

> `optional` **fetch**: (`input`, `init`?) => `Promise`\<`Response`\>

Defined in: [src/ax/db/cloudflare.ts:38](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbcloudflaretsl38)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `input` | `string` \| `URL` \| `Request` |
| `init`? | `RequestInit` |

#### Returns

`Promise`\<`Response`\>

#### Overrides

[`AxDBBaseArgs`](#apidocs/interfaceaxdbbaseargs).[`fetch`](#apidocs/interfaceaxdbbaseargsmdfetch)

***

<a id="name"></a>

### name

> **name**: `"cloudflare"`

Defined in: [src/ax/db/cloudflare.ts:35](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbcloudflaretsl35)

***

<a id="tracer"></a>

### tracer?

> `optional` **tracer**: `Tracer`

Defined in: [src/ax/db/base.ts:15](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbbasetsl15)

#### Inherited from

[`AxDBBaseArgs`](#apidocs/interfaceaxdbbaseargs).[`tracer`](#apidocs/interfaceaxdbbaseargsmdtracer)
