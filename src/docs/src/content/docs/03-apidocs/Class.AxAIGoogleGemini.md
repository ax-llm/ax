---
title: AxAIGoogleGemini
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/google-gemini/api.ts#L494

AxAIGoogleGemini: AI Service

## Extends

- [`AxBaseAI`](/api/#03-apidocs/classaxbaseai)\<[`AxAIGoogleGeminiModel`](/api/#03-apidocs/enumerationaxaigooglegeminimodel), [`AxAIGoogleGeminiEmbedModel`](/api/#03-apidocs/enumerationaxaigooglegeminiembedmodel), [`AxAIGoogleGeminiChatRequest`](/api/#03-apidocs/typealiasaxaigooglegeminichatrequest), [`AxAIGoogleGeminiBatchEmbedRequest`](/api/#03-apidocs/typealiasaxaigooglegeminibatchembedrequest) \| [`AxAIGoogleVertexBatchEmbedRequest`](/api/#03-apidocs/typealiasaxaigooglevertexbatchembedrequest), [`AxAIGoogleGeminiChatResponse`](/api/#03-apidocs/typealiasaxaigooglegeminichatresponse), [`AxAIGoogleGeminiChatResponseDelta`](/api/#03-apidocs/typealiasaxaigooglegeminichatresponsedelta), [`AxAIGoogleGeminiBatchEmbedResponse`](/api/#03-apidocs/typealiasaxaigooglegeminibatchembedresponse) \| [`AxAIGoogleVertexBatchEmbedResponse`](/api/#03-apidocs/typealiasaxaigooglevertexbatchembedresponse)\>

## Constructors

<a id="constructors"></a>

### new AxAIGoogleGemini()

> **new AxAIGoogleGemini**(`__namedParameters`): [`AxAIGoogleGemini`](/api/#03-apidocs/classaxaigooglegemini)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/google-gemini/api.ts#L503

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `__namedParameters` | `Readonly`\<`Omit`\<[`AxAIGoogleGeminiArgs`](/api/#03-apidocs/interfaceaxaigooglegeminiargs), `"name"`\>\> |

#### Returns

[`AxAIGoogleGemini`](/api/#03-apidocs/classaxaigooglegemini)

#### Overrides

[`AxBaseAI`](/api/#03-apidocs/classaxbaseai).[`constructor`](/api/#03-apidocs/classaxbaseaimdconstructors)

## Methods

<a id="chat"></a>

### chat()

> **chat**(`req`, `options`?): `Promise`\<[`AxChatResponse`](/api/#03-apidocs/typealiasaxchatresponse) \| `ReadableStream`\<[`AxChatResponse`](/api/#03-apidocs/typealiasaxchatresponse)\>\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L290

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxChatRequest`](/api/#03-apidocs/typealiasaxchatrequest)\<[`AxAIGoogleGeminiModel`](/api/#03-apidocs/enumerationaxaigooglegeminimodel)\>\> |
| `options`? | `Readonly`\<[`AxAIPromptConfig`](/api/#03-apidocs/typealiasaxaipromptconfig) & [`AxAIServiceActionOptions`](/api/#03-apidocs/typealiasaxaiserviceactionoptions)\<[`AxAIGoogleGeminiModel`](/api/#03-apidocs/enumerationaxaigooglegeminimodel), [`AxAIGoogleGeminiEmbedModel`](/api/#03-apidocs/enumerationaxaigooglegeminiembedmodel)\>\> |

#### Returns

`Promise`\<[`AxChatResponse`](/api/#03-apidocs/typealiasaxchatresponse) \| `ReadableStream`\<[`AxChatResponse`](/api/#03-apidocs/typealiasaxchatresponse)\>\>

#### Inherited from

[`AxBaseAI`](/api/#03-apidocs/classaxbaseai).[`chat`](/api/#03-apidocs/classaxbaseaimdchat)

***

<a id="embed"></a>

### embed()

> **embed**(`req`, `options`?): `Promise`\<[`AxEmbedResponse`](/api/#03-apidocs/typealiasaxembedresponse)\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L524

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxEmbedRequest`](/api/#03-apidocs/typealiasaxembedrequest)\<[`AxAIGoogleGeminiEmbedModel`](/api/#03-apidocs/enumerationaxaigooglegeminiembedmodel)\>\> |
| `options`? | `Readonly`\<[`AxAIServiceActionOptions`](/api/#03-apidocs/typealiasaxaiserviceactionoptions)\<[`AxAIGoogleGeminiModel`](/api/#03-apidocs/enumerationaxaigooglegeminimodel), [`AxAIGoogleGeminiEmbedModel`](/api/#03-apidocs/enumerationaxaigooglegeminiembedmodel)\>\> |

#### Returns

`Promise`\<[`AxEmbedResponse`](/api/#03-apidocs/typealiasaxembedresponse)\>

#### Inherited from

[`AxBaseAI`](/api/#03-apidocs/classaxbaseai).[`embed`](/api/#03-apidocs/classaxbaseaimdembed)

***

<a id="getDefaultModels"></a>

### getDefaultModels()

> **getDefaultModels**(): `Readonly`\<\{ `embedModel`: `string`; `model`: `string`; \}\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L230

#### Returns

`Readonly`\<\{ `embedModel`: `string`; `model`: `string`; \}\>

#### Inherited from

[`AxBaseAI`](/api/#03-apidocs/classaxbaseai).[`getDefaultModels`](/api/#03-apidocs/classaxbaseaimdgetdefaultmodels)

***

<a id="getFeatures"></a>

### getFeatures()

> **getFeatures**(`model`?): [`AxAIFeatures`](/api/#03-apidocs/interfaceaxaifeatures)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L241

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `model`? | [`AxAIGoogleGeminiModel`](/api/#03-apidocs/enumerationaxaigooglegeminimodel) |

#### Returns

[`AxAIFeatures`](/api/#03-apidocs/interfaceaxaifeatures)

#### Inherited from

[`AxBaseAI`](/api/#03-apidocs/classaxbaseai).[`getFeatures`](/api/#03-apidocs/classaxbaseaimdgetfeatures)

***

<a id="getId"></a>

### getId()

> **getId**(): `string`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L181

#### Returns

`string`

#### Inherited from

[`AxBaseAI`](/api/#03-apidocs/classaxbaseai).[`getId`](/api/#03-apidocs/classaxbaseaimdgetid)

***

<a id="getMetrics"></a>

### getMetrics()

> **getMetrics**(): [`AxAIServiceMetrics`](/api/#03-apidocs/interfaceaxaiservicemetrics)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L286

#### Returns

[`AxAIServiceMetrics`](/api/#03-apidocs/interfaceaxaiservicemetrics)

#### Inherited from

[`AxBaseAI`](/api/#03-apidocs/classaxbaseai).[`getMetrics`](/api/#03-apidocs/classaxbaseaimdgetmetrics)

***

<a id="getModelList"></a>

### getModelList()

> **getModelList**(): `undefined` \| [`AxAIModelList`](/api/#03-apidocs/typealiasaxaimodellist)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L220

#### Returns

`undefined` \| [`AxAIModelList`](/api/#03-apidocs/typealiasaxaimodellist)

#### Inherited from

[`AxBaseAI`](/api/#03-apidocs/classaxbaseai).[`getModelList`](/api/#03-apidocs/classaxbaseaimdgetmodellist)

***

<a id="getName"></a>

### getName()

> **getName**(): `string`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L237

#### Returns

`string`

#### Inherited from

[`AxBaseAI`](/api/#03-apidocs/classaxbaseai).[`getName`](/api/#03-apidocs/classaxbaseaimdgetname)

***

<a id="getOptions"></a>

### getOptions()

> **getOptions**(): `Readonly`\<[`AxAIServiceOptions`](/api/#03-apidocs/typealiasaxaiserviceoptions)\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L211

#### Returns

`Readonly`\<[`AxAIServiceOptions`](/api/#03-apidocs/typealiasaxaiserviceoptions)\>

#### Inherited from

[`AxBaseAI`](/api/#03-apidocs/classaxbaseai).[`getOptions`](/api/#03-apidocs/classaxbaseaimdgetoptions)

***

<a id="setAPIURL"></a>

### setAPIURL()

> **setAPIURL**(`apiURL`): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L185

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `apiURL` | `string` |

#### Returns

`void`

#### Inherited from

[`AxBaseAI`](/api/#03-apidocs/classaxbaseai).[`setAPIURL`](/api/#03-apidocs/classaxbaseaimdsetapiurl)

***

<a id="setHeaders"></a>

### setHeaders()

> **setHeaders**(`headers`): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L189

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `headers` | () => `Promise`\<`Record`\<`string`, `string`\>\> |

#### Returns

`void`

#### Inherited from

[`AxBaseAI`](/api/#03-apidocs/classaxbaseai).[`setHeaders`](/api/#03-apidocs/classaxbaseaimdsetheaders)

***

<a id="setName"></a>

### setName()

> **setName**(`name`): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L177

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `name` | `string` |

#### Returns

`void`

#### Inherited from

[`AxBaseAI`](/api/#03-apidocs/classaxbaseai).[`setName`](/api/#03-apidocs/classaxbaseaimdsetname)

***

<a id="setOptions"></a>

### setOptions()

> **setOptions**(`options`): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L193

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | `Readonly`\<[`AxAIServiceOptions`](/api/#03-apidocs/typealiasaxaiserviceoptions)\> |

#### Returns

`void`

#### Inherited from

[`AxBaseAI`](/api/#03-apidocs/classaxbaseai).[`setOptions`](/api/#03-apidocs/classaxbaseaimdsetoptions)
