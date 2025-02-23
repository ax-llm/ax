---
title: AxDBPineconeArgs
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/pinecone.ts#L48

## Extends

- [`AxDBBaseArgs`](/api/#03-apidocs/interfaceaxdbbaseargs)

## Properties

<a id="apiKey"></a>

### apiKey

> **apiKey**: `string`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/pinecone.ts#L50

***

<a id="fetch"></a>

### fetch()?

> `optional` **fetch**: (`input`, `init`?) => `Promise`\<`Response`\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/pinecone.ts#L52

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

<a id="host"></a>

### host

> **host**: `string`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/pinecone.ts#L51

***

<a id="name"></a>

### name

> **name**: `"pinecone"`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/pinecone.ts#L49

***

<a id="tracer"></a>

### tracer?

> `optional` **tracer**: `Tracer`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/base.ts#L15

#### Inherited from

[`AxDBBaseArgs`](/api/#03-apidocs/interfaceaxdbbaseargs).[`tracer`](/api/#03-apidocs/interfaceaxdbbaseargsmdtracer)
