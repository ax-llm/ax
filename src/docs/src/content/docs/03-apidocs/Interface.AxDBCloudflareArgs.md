---
title: AxDBCloudflareArgs
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/cloudflare.ts#L34

## Extends

- [`AxDBBaseArgs`](/api/#03-apidocs/interfaceaxdbbaseargs)

## Properties

<a id="accountId"></a>

### accountId

> **accountId**: `string`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/cloudflare.ts#L37

***

<a id="apiKey"></a>

### apiKey

> **apiKey**: `string`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/cloudflare.ts#L36

***

<a id="fetch"></a>

### fetch()?

> `optional` **fetch**: (`input`, `init`?) => `Promise`\<`Response`\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/cloudflare.ts#L38

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `input` | `string` \| `URL` \| `Request` |
| `init`? | `RequestInit` |

#### Returns

`Promise`\<`Response`\>

#### Overrides

[`AxDBBaseArgs`](/api/#03-apidocs/interfaceaxdbbaseargs).[`fetch`](/api/#03-apidocs/interfaceaxdbbaseargsmdfetch)

***

<a id="name"></a>

### name

> **name**: `"cloudflare"`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/cloudflare.ts#L35

***

<a id="tracer"></a>

### tracer?

> `optional` **tracer**: `Tracer`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/base.ts#L15

#### Inherited from

[`AxDBBaseArgs`](/api/#03-apidocs/interfaceaxdbbaseargs).[`tracer`](/api/#03-apidocs/interfaceaxdbbaseargsmdtracer)
