---
title: AxDBPineconeArgs
---

Defined in: [src/ax/db/pinecone.ts:48](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbpineconetsl48)

## Extends

- [`AxDBBaseArgs`](#apidocs/interfaceaxdbbaseargs)

## Properties

<a id="apiKey"></a>

### apiKey

> **apiKey**: `string`

Defined in: [src/ax/db/pinecone.ts:50](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbpineconetsl50)

***

<a id="fetch"></a>

### fetch()?

> `optional` **fetch**: (`input`, `init`?) => `Promise`\<`Response`\>

Defined in: [src/ax/db/pinecone.ts:52](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbpineconetsl52)

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

Defined in: [src/ax/db/pinecone.ts:51](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbpineconetsl51)

***

<a id="name"></a>

### name

> **name**: `"pinecone"`

Defined in: [src/ax/db/pinecone.ts:49](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbpineconetsl49)

***

<a id="tracer"></a>

### tracer?

> `optional` **tracer**: `Tracer`

Defined in: [src/ax/db/base.ts:15](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbbasetsl15)

#### Inherited from

[`AxDBBaseArgs`](#apidocs/interfaceaxdbbaseargs).[`tracer`](#apidocs/interfaceaxdbbaseargsmdtracer)
