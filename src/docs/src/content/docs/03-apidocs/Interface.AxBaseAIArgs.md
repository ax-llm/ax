---
title: AxBaseAIArgs
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L38

## Type Parameters

| Type Parameter |
| :------ |
| `TModel` |
| `TEmbedModel` |

## Properties

| Property | Type |
| :------ | :------ |
| <a id="apiURL"></a> `apiURL` | `string` |
| <a id="defaults"></a> `defaults` | `Readonly`\<\{ `embedModel`: `TEmbedModel`; `model`: `TModel`; \}\> |
| <a id="headers"></a> `headers` | () => `Promise`\<`Record`\<`string`, `string`\>\> |
| <a id="modelInfo"></a> `modelInfo` | readonly [`AxModelInfo`](/api/#03-apidocs/typealiasaxmodelinfo)[] |
| <a id="models"></a> `models?` | [`AxAIInputModelList`](/api/#03-apidocs/typealiasaxaiinputmodellist)\<`TModel`, `TEmbedModel`\> |
| <a id="name"></a> `name` | `string` |
| <a id="options"></a> `options?` | `Readonly`\<[`AxAIServiceOptions`](/api/#03-apidocs/typealiasaxaiserviceoptions)\> |
| <a id="supportFor"></a> `supportFor` | \| [`AxAIFeatures`](/api/#03-apidocs/interfaceaxaifeatures) \| (`model`: `TModel`) => [`AxAIFeatures`](/api/#03-apidocs/interfaceaxaifeatures) |
