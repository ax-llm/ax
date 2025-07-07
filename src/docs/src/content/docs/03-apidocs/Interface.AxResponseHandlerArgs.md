---
title: AxResponseHandlerArgs
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/generate.ts#L70

## Type Parameters

| Type Parameter |
| :------ |
| `T` |

## Properties

| Property | Type |
| :------ | :------ |
| <a id="ai"></a> `ai` | `Readonly`\<[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)\<`unknown`, `unknown`\>\> |
| <a id="fastFail"></a> `fastFail?` | `boolean` |
| <a id="functions"></a> `functions?` | readonly [`AxFunction`](/api/#03-apidocs/typealiasaxfunction)[] |
| <a id="mem"></a> `mem` | [`AxAIMemory`](/api/#03-apidocs/interfaceaxaimemory) |
| <a id="model"></a> `model?` | `string` |
| <a id="res"></a> `res` | `T` |
| <a id="sessionId"></a> `sessionId?` | `string` |
| <a id="span"></a> `span?` | `Span` |
| <a id="traceId"></a> `traceId?` | `string` |
