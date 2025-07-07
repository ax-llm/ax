---
title: AxDBCloudflareArgs
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/db/cloudflare.ts#L34

## Extends

- [`AxDBBaseArgs`](/api/#03-apidocs/interfaceaxdbbaseargs)

## Properties

| Property | Type | Overrides | Inherited from |
| :------ | :------ | :------ | :------ |
| <a id="accountId"></a> `accountId` | `string` | - | - |
| <a id="apiKey"></a> `apiKey` | `string` | - | - |
| <a id="fetch"></a> `fetch?` | (`input`: `string` \| `URL` \| `Request`, `init`?: `RequestInit`) => `Promise`\<`Response`\> | [`AxDBBaseArgs`](/api/#03-apidocs/interfaceaxdbbaseargs).[`fetch`](/api/#03-apidocs/interfaceaxdbbaseargsmdfetch) | - |
| <a id="name"></a> `name` | `"cloudflare"` | - | - |
| <a id="tracer"></a> `tracer?` | `Tracer` | - | [`AxDBBaseArgs`](/api/#03-apidocs/interfaceaxdbbaseargs).[`tracer`](/api/#03-apidocs/interfaceaxdbbaseargsmdtracer) |
