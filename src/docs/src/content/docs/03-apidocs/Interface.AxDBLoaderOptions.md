---
title: AxDBLoaderOptions
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/docs/manager.ts#L11

## Properties

| Property | Type |
| :------ | :------ |
| <a id="chunker"></a> `chunker?` | (`text`: `string`) => `string`[] |
| <a id="reranker"></a> `reranker?` | [`AxProgram`](/api/#03-apidocs/classaxprogram)\<[`AxRerankerIn`](/api/#03-apidocs/typealiasaxrerankerin), [`AxRerankerOut`](/api/#03-apidocs/typealiasaxrerankerout)\> |
| <a id="rewriter"></a> `rewriter?` | [`AxProgram`](/api/#03-apidocs/classaxprogram)\<[`AxRewriteIn`](/api/#03-apidocs/typealiasaxrewritein), [`AxRewriteOut`](/api/#03-apidocs/typealiasaxrewriteout)\> |
