---
title: AxBaseAI
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L61

## Extended by

- [`AxAIAnthropic`](/api/#03-apidocs/classaxaianthropic)
- [`AxAICohere`](/api/#03-apidocs/classaxaicohere)
- [`AxAIGoogleGemini`](/api/#03-apidocs/classaxaigooglegemini)
- [`AxAIHuggingFace`](/api/#03-apidocs/classaxaihuggingface)
- [`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase)
- [`AxAIReka`](/api/#03-apidocs/classaxaireka)

## Type Parameters

| Type Parameter |
| ------ |
| `TModel` |
| `TEmbedModel` |
| `TChatRequest` |
| `TEmbedRequest` |
| `TChatResponse` |
| `TChatResponseDelta` |
| `TEmbedResponse` |

## Implements

- [`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)\<`TModel`, `TEmbedModel`\>

## Constructors

<a id="constructors"></a>

### new AxBaseAI()

> **new AxBaseAI**\<`TModel`, `TEmbedModel`, `TChatRequest`, `TEmbedRequest`, `TChatResponse`, `TChatResponseDelta`, `TEmbedResponse`\>(`aiImpl`, `__namedParameters`): [`AxBaseAI`](/api/#03-apidocs/classaxbaseai)\<`TModel`, `TEmbedModel`, `TChatRequest`, `TEmbedRequest`, `TChatResponse`, `TChatResponseDelta`, `TEmbedResponse`\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L122

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `aiImpl` | `Readonly`\<[`AxAIServiceImpl`](/api/#03-apidocs/interfaceaxaiserviceimpl)\<`TModel`, `TEmbedModel`, `TChatRequest`, `TEmbedRequest`, `TChatResponse`, `TChatResponseDelta`, `TEmbedResponse`\>\> |
| `__namedParameters` | `Readonly`\<[`AxBaseAIArgs`](/api/#03-apidocs/interfaceaxbaseaiargs)\<`TModel`, `TEmbedModel`\>\> |

#### Returns

[`AxBaseAI`](/api/#03-apidocs/classaxbaseai)\<`TModel`, `TEmbedModel`, `TChatRequest`, `TEmbedRequest`, `TChatResponse`, `TChatResponseDelta`, `TEmbedResponse`\>

## Methods

<a id="chat"></a>

### chat()

> **chat**(`req`, `options`?): `Promise`\<[`AxChatResponse`](/api/#03-apidocs/typealiasaxchatresponse) \| `ReadableStream`\<[`AxChatResponse`](/api/#03-apidocs/typealiasaxchatresponse)\>\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L290

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxChatRequest`](/api/#03-apidocs/typealiasaxchatrequest)\<`TModel`\>\> |
| `options`? | `Readonly`\<[`AxAIPromptConfig`](/api/#03-apidocs/typealiasaxaipromptconfig) & [`AxAIServiceActionOptions`](/api/#03-apidocs/typealiasaxaiserviceactionoptions)\<`TModel`, `TEmbedModel`\>\> |

#### Returns

`Promise`\<[`AxChatResponse`](/api/#03-apidocs/typealiasaxchatresponse) \| `ReadableStream`\<[`AxChatResponse`](/api/#03-apidocs/typealiasaxchatresponse)\>\>

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`chat`](/api/#03-apidocs/interfaceaxaiservicemdchat)

***

<a id="embed"></a>

### embed()

> **embed**(`req`, `options`?): `Promise`\<[`AxEmbedResponse`](/api/#03-apidocs/typealiasaxembedresponse)\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L524

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxEmbedRequest`](/api/#03-apidocs/typealiasaxembedrequest)\<`TEmbedModel`\>\> |
| `options`? | `Readonly`\<[`AxAIServiceActionOptions`](/api/#03-apidocs/typealiasaxaiserviceactionoptions)\<`TModel`, `TEmbedModel`\>\> |

#### Returns

`Promise`\<[`AxEmbedResponse`](/api/#03-apidocs/typealiasaxembedresponse)\>

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`embed`](/api/#03-apidocs/interfaceaxaiservicemdembed)

***

<a id="getDefaultModels"></a>

### getDefaultModels()

> **getDefaultModels**(): `Readonly`\<\{ `embedModel`: `string`; `model`: `string`; \}\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L230

#### Returns

`Readonly`\<\{ `embedModel`: `string`; `model`: `string`; \}\>

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`getDefaultModels`](/api/#03-apidocs/interfaceaxaiservicemdgetdefaultmodels)

***

<a id="getFeatures"></a>

### getFeatures()

> **getFeatures**(`model`?): [`AxAIFeatures`](/api/#03-apidocs/interfaceaxaifeatures)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L241

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `model`? | `TModel` |

#### Returns

[`AxAIFeatures`](/api/#03-apidocs/interfaceaxaifeatures)

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`getFeatures`](/api/#03-apidocs/interfaceaxaiservicemdgetfeatures)

***

<a id="getId"></a>

### getId()

> **getId**(): `string`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L181

#### Returns

`string`

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`getId`](/api/#03-apidocs/interfaceaxaiservicemdgetid)

***

<a id="getMetrics"></a>

### getMetrics()

> **getMetrics**(): [`AxAIServiceMetrics`](/api/#03-apidocs/interfaceaxaiservicemetrics)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L286

#### Returns

[`AxAIServiceMetrics`](/api/#03-apidocs/interfaceaxaiservicemetrics)

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`getMetrics`](/api/#03-apidocs/interfaceaxaiservicemdgetmetrics)

***

<a id="getModelList"></a>

### getModelList()

> **getModelList**(): `undefined` \| [`AxAIModelList`](/api/#03-apidocs/typealiasaxaimodellist)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L220

#### Returns

`undefined` \| [`AxAIModelList`](/api/#03-apidocs/typealiasaxaimodellist)

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`getModelList`](/api/#03-apidocs/interfaceaxaiservicemdgetmodellist)

***

<a id="getName"></a>

### getName()

> **getName**(): `string`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L237

#### Returns

`string`

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`getName`](/api/#03-apidocs/interfaceaxaiservicemdgetname)

***

<a id="getOptions"></a>

### getOptions()

> **getOptions**(): `Readonly`\<[`AxAIServiceOptions`](/api/#03-apidocs/typealiasaxaiserviceoptions)\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L211

#### Returns

`Readonly`\<[`AxAIServiceOptions`](/api/#03-apidocs/typealiasaxaiserviceoptions)\>

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`getOptions`](/api/#03-apidocs/interfaceaxaiservicemdgetoptions)

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

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`setOptions`](/api/#03-apidocs/interfaceaxaiservicemdsetoptions)
