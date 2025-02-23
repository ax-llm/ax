---
title: AxDBBaseArgs
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/base.ts#L13

## Extended by

- [`AxDBCloudflareArgs`](/api/#03-apidocs/interfaceaxdbcloudflareargs)
- [`AxDBMemoryArgs`](/api/#03-apidocs/interfaceaxdbmemoryargs)
- [`AxDBPineconeArgs`](/api/#03-apidocs/interfaceaxdbpineconeargs)
- [`AxDBWeaviateArgs`](/api/#03-apidocs/interfaceaxdbweaviateargs)

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

***

<a id="tracer"></a>

### tracer?

> `optional` **tracer**: `Tracer`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/db/base.ts#L15
