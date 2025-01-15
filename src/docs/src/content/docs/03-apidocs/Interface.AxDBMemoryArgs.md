---
title: AxDBMemoryArgs
---

Defined in: [src/ax/db/memory.ts:11](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbmemorytsl11)

## Extends

- [`AxDBBaseArgs`](#apidocs/interfaceaxdbbaseargs)

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

#### Inherited from

[`AxDBBaseArgs`](#apidocs/interfaceaxdbbaseargs).[`fetch`](#apidocs/interfaceaxdbbaseargsmdfetch)

***

<a id="name"></a>

### name

> **name**: `"memory"`

Defined in: [src/ax/db/memory.ts:12](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbmemorytsl12)

***

<a id="tracer"></a>

### tracer?

> `optional` **tracer**: `Tracer`

Defined in: [src/ax/db/base.ts:15](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdbbasetsl15)

#### Inherited from

[`AxDBBaseArgs`](#apidocs/interfaceaxdbbaseargs).[`tracer`](#apidocs/interfaceaxdbbaseargsmdtracer)
