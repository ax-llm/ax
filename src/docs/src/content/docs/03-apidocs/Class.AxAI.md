---
title: AxAI
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/wrap.ts#L77

## Implements

- [`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)

## Constructors

<a id="constructors"></a>

### new AxAI()

> **new AxAI**(`options`): [`AxAI`](/api/#03-apidocs/classaxai)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/wrap.ts#L80

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | `Readonly`\<[`AxAIArgs`](/api/#03-apidocs/typealiasaxaiargs)\> |

#### Returns

[`AxAI`](/api/#03-apidocs/classaxai)

## Methods

<a id="chat"></a>

### chat()

> **chat**(`req`, `options`?): `Promise`\<[`AxChatResponse`](/api/#03-apidocs/typealiasaxchatresponse) \| `ReadableStream`\<[`AxChatResponse`](/api/#03-apidocs/typealiasaxchatresponse)\>\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/wrap.ts#L146

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxChatRequest`](/api/#03-apidocs/typealiasaxchatrequest)\> |
| `options`? | `Readonly`\<[`AxAIPromptConfig`](/api/#03-apidocs/typealiasaxaipromptconfig) & [`AxAIServiceActionOptions`](/api/#03-apidocs/typealiasaxaiserviceactionoptions)\> |

#### Returns

`Promise`\<[`AxChatResponse`](/api/#03-apidocs/typealiasaxchatresponse) \| `ReadableStream`\<[`AxChatResponse`](/api/#03-apidocs/typealiasaxchatresponse)\>\>

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`chat`](/api/#03-apidocs/interfaceaxaiservicemdchat)

***

<a id="embed"></a>

### embed()

> **embed**(`req`, `options`?): `Promise`\<[`AxEmbedResponse`](/api/#03-apidocs/typealiasaxembedresponse)\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/wrap.ts#L153

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxEmbedRequest`](/api/#03-apidocs/typealiasaxembedrequest)\> |
| `options`? | `Readonly`\<[`AxAIServiceActionOptions`](/api/#03-apidocs/typealiasaxaiserviceactionoptions)\> |

#### Returns

`Promise`\<[`AxEmbedResponse`](/api/#03-apidocs/typealiasaxembedresponse)\>

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`embed`](/api/#03-apidocs/interfaceaxaiservicemdembed)

***

<a id="getDefaultModels"></a>

### getDefaultModels()

> **getDefaultModels**(): `Readonly`\<\{ `embedModel`: `string`; `model`: `string`; \}\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/wrap.ts#L138

#### Returns

`Readonly`\<\{ `embedModel`: `string`; `model`: `string`; \}\>

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`getDefaultModels`](/api/#03-apidocs/interfaceaxaiservicemdgetdefaultmodels)

***

<a id="getFeatures"></a>

### getFeatures()

> **getFeatures**(`model`?): `object`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/wrap.ts#L131

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `model`? | `string` |

#### Returns

`object`

<a id="functions"></a>

##### functions

> **functions**: `boolean`

<a id="streaming"></a>

##### streaming

> **streaming**: `boolean`

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`getFeatures`](/api/#03-apidocs/interfaceaxaiservicemdgetfeatures)

***

<a id="getId"></a>

### getId()

> **getId**(): `string`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/wrap.ts#L127

#### Returns

`string`

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`getId`](/api/#03-apidocs/interfaceaxaiservicemdgetid)

***

<a id="getMetrics"></a>

### getMetrics()

> **getMetrics**(): [`AxAIServiceMetrics`](/api/#03-apidocs/interfaceaxaiservicemetrics)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/wrap.ts#L142

#### Returns

[`AxAIServiceMetrics`](/api/#03-apidocs/interfaceaxaiservicemetrics)

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`getMetrics`](/api/#03-apidocs/interfaceaxaiservicemdgetmetrics)

***

<a id="getModelList"></a>

### getModelList()

> **getModelList**(): `undefined` \| [`AxAIModelList`](/api/#03-apidocs/typealiasaxaimodellist)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/wrap.ts#L134

#### Returns

`undefined` \| [`AxAIModelList`](/api/#03-apidocs/typealiasaxaimodellist)

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`getModelList`](/api/#03-apidocs/interfaceaxaiservicemdgetmodellist)

***

<a id="getName"></a>

### getName()

> **getName**(): `string`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/wrap.ts#L123

#### Returns

`string`

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`getName`](/api/#03-apidocs/interfaceaxaiservicemdgetname)

***

<a id="getOptions"></a>

### getOptions()

> **getOptions**(): `Readonly`\<[`AxAIServiceOptions`](/api/#03-apidocs/typealiasaxaiserviceoptions)\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/wrap.ts#L164

#### Returns

`Readonly`\<[`AxAIServiceOptions`](/api/#03-apidocs/typealiasaxaiserviceoptions)\>

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`getOptions`](/api/#03-apidocs/interfaceaxaiservicemdgetoptions)

***

<a id="setOptions"></a>

### setOptions()

> **setOptions**(`options`): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/wrap.ts#L160

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | `Readonly`\<[`AxAIServiceOptions`](/api/#03-apidocs/typealiasaxaiserviceoptions)\> |

#### Returns

`void`

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`setOptions`](/api/#03-apidocs/interfaceaxaiservicemdsetoptions)
