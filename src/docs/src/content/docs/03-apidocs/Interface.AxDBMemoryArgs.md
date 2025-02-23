---
title: AxDBMemoryArgs
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/memory.ts#L11

## Extends

- [`AxDBBaseArgs`](/api/#03-apidocs/interfaceaxdbbaseargs)

## Properties

<a id="fetch"></a>

### fetch()?

> `optional` **fetch**: (`input`, `init`?) => `Promise`\<`Response`\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/base.ts#L14

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `input` | `string` \| `URL` \| `Request` |
| `init`? | `RequestInit` |

#### Returns

`Promise`\<`Response`\>

#### Inherited from

[`AxDBBaseArgs`](/api/#03-apidocs/interfaceaxdbbaseargs).[`fetch`](/api/#03-apidocs/interfaceaxdbbaseargsmdfetch)

***

<a id="name"></a>

### name

> **name**: `"memory"`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/memory.ts#L12

***

<a id="tracer"></a>

### tracer?

> `optional` **tracer**: `Tracer`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/base.ts#L15

#### Inherited from

[`AxDBBaseArgs`](/api/#03-apidocs/interfaceaxdbbaseargs).[`tracer`](/api/#03-apidocs/interfaceaxdbbaseargsmdtracer)
