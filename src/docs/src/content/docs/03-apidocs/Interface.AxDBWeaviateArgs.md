---
title: AxDBWeaviateArgs
---

Defined in: [src/ax/db/weaviate.ts:29](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbweaviatetsl29)

## Extends

- [`AxDBBaseArgs`](#apidocs/interfaceaxdbbaseargs)

## Properties

<a id="apiKey"></a>

### apiKey

> **apiKey**: `string`

Defined in: [src/ax/db/weaviate.ts:31](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbweaviatetsl31)

***

<a id="fetch"></a>

### fetch()?

> `optional` **fetch**: (`input`, `init`?) => `Promise`\<`Response`\>

Defined in: [src/ax/db/weaviate.ts:33](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbweaviatetsl33)

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

<a id="host"></a>

### host

> **host**: `string`

Defined in: [src/ax/db/weaviate.ts:32](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbweaviatetsl32)

***

<a id="name"></a>

### name

> **name**: `"weaviate"`

Defined in: [src/ax/db/weaviate.ts:30](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbweaviatetsl30)

***

<a id="tracer"></a>

### tracer?

> `optional` **tracer**: `Tracer`

Defined in: [src/ax/db/base.ts:15](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbbasetsl15)

#### Inherited from

[`AxDBBaseArgs`](#apidocs/interfaceaxdbbaseargs).[`tracer`](#apidocs/interfaceaxdbbaseargsmdtracer)
