---
title: AxDBLoaderOptions
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/docs/manager.ts#L14

## Properties

<a id="chunker"></a>

### chunker()?

> `optional` **chunker**: (`text`) => `string`[]

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/docs/manager.ts#L15

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `text` | `string` |

#### Returns

`string`[]

***

<a id="reranker"></a>

### reranker?

> `optional` **reranker**: [`AxProgram`](/api/#03-apidocs/classaxprogram)\<[`AxRerankerIn`](/api/#03-apidocs/typealiasaxrerankerin), [`AxRerankerOut`](/api/#03-apidocs/typealiasaxrerankerout)\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/docs/manager.ts#L17

***

<a id="rewriter"></a>

### rewriter?

> `optional` **rewriter**: [`AxProgram`](/api/#03-apidocs/classaxprogram)\<[`AxRewriteIn`](/api/#03-apidocs/typealiasaxrewritein), [`AxRewriteOut`](/api/#03-apidocs/typealiasaxrewriteout)\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/docs/manager.ts#L16
