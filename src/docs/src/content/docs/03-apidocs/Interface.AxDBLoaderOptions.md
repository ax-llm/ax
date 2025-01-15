---
title: AxDBLoaderOptions
---

Defined in: [src/ax/docs/manager.ts:14](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdocsmanagertsl14)

## Properties

<a id="chunker"></a>

### chunker()?

> `optional` **chunker**: (`text`) => `string`[]

Defined in: [src/ax/docs/manager.ts:15](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdocsmanagertsl15)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `text` | `string` |

#### Returns

`string`[]

***

<a id="reranker"></a>

### reranker?

> `optional` **reranker**: [`AxProgram`](#apidocs/classaxprogram)\<[`AxRerankerIn`](#apidocs/typealiasaxrerankerin), [`AxRerankerOut`](#apidocs/typealiasaxrerankerout)\>

Defined in: [src/ax/docs/manager.ts:17](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdocsmanagertsl17)

***

<a id="rewriter"></a>

### rewriter?

> `optional` **rewriter**: [`AxProgram`](#apidocs/classaxprogram)\<[`AxRewriteIn`](#apidocs/typealiasaxrewritein), [`AxRewriteOut`](#apidocs/typealiasaxrewriteout)\>

Defined in: [src/ax/docs/manager.ts:16](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdocsmanagertsl16)
