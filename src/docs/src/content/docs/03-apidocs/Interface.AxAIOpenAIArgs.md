---
title: AxAIOpenAIArgs
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/openai/api.ts#L74

## Extends

- `Omit`\<[`AxAIOpenAIBaseArgs`](/api/#03-apidocs/interfaceaxaiopenaibaseargs)\<`TModel`, `TEmbedModel`, `TChatReq`\>, `"config"` \| `"supportFor"` \| `"modelInfo"`\>

## Type Parameters

| Type Parameter | Default type |
| :------ | :------ |
| `TName` | `"openai"` |
| `TModel` | [`AxAIOpenAIModel`](/api/#03-apidocs/enumerationaxaiopenaimodel) |
| `TEmbedModel` | [`AxAIOpenAIEmbedModel`](/api/#03-apidocs/enumerationaxaiopenaiembedmodel) |
| `TChatReq` *extends* [`AxAIOpenAIChatRequest`](/api/#03-apidocs/typealiasaxaiopenaichatrequest)\<`TModel`\> | [`AxAIOpenAIChatRequest`](/api/#03-apidocs/typealiasaxaiopenaichatrequest)\<`TModel`\> |

## Properties

| Property | Type | Inherited from |
| :------ | :------ | :------ |
| <a id="apiKey"></a> `apiKey` | `string` | `Omit.apiKey` |
| <a id="apiURL"></a> `apiURL?` | `string` | `Omit.apiURL` |
| <a id="chatReqUpdater"></a> `chatReqUpdater?` | `ChatReqUpdater`\<`TModel`, `TChatReq`\> | `Omit.chatReqUpdater` |
| <a id="config"></a> `config?` | `Partial`\<`Readonly`\<[`AxAIOpenAIConfig`](/api/#03-apidocs/typealiasaxaiopenaiconfig)\<`TModel`, `TEmbedModel`\>\>\> | - |
| <a id="modelInfo"></a> `modelInfo?` | [`AxModelInfo`](/api/#03-apidocs/typealiasaxmodelinfo)[] | - |
| <a id="models"></a> `models?` | [`AxAIInputModelList`](/api/#03-apidocs/typealiasaxaiinputmodellist)\<`TModel`, `TEmbedModel`\> | `Omit.models` |
| <a id="name"></a> `name` | `TName` | - |
| <a id="options"></a> `options?` | `Readonly`\<[`AxAIServiceOptions`](/api/#03-apidocs/typealiasaxaiserviceoptions) & `object`\> | `Omit.options` |
