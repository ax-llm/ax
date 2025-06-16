---
title: AxDBBaseArgs
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/db/base.ts#L13

## Extended by

- [`AxDBCloudflareArgs`](/api/#03-apidocs/interfaceaxdbcloudflareargs)
- [`AxDBMemoryArgs`](/api/#03-apidocs/interfaceaxdbmemoryargs)
- [`AxDBPineconeArgs`](/api/#03-apidocs/interfaceaxdbpineconeargs)
- [`AxDBWeaviateArgs`](/api/#03-apidocs/interfaceaxdbweaviateargs)

## Properties

| Property | Type |
| :------ | :------ |
| <a id="fetch"></a> `fetch?` | (`input`: `string` \| `URL` \| `Request`, `init`?: `RequestInit`) => `Promise`\<`Response`\> |
| <a id="tracer"></a> `tracer?` | `Tracer` |
