---
title: AxAIService
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/types.ts#L245

## Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `TModel` | `unknown` |
| `TEmbedModel` | `unknown` |

## Methods

<a id="chat"></a>

### chat()

> **chat**(`req`, `options`?): `Promise`\<[`AxChatResponse`](/api/#03-apidocs/typealiasaxchatresponse) \| `ReadableStream`\<[`AxChatResponse`](/api/#03-apidocs/typealiasaxchatresponse)\>\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/types.ts#L253

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxChatRequest`](/api/#03-apidocs/typealiasaxchatrequest)\<`TModel`\>\> |
| `options`? | `Readonly`\<[`AxAIPromptConfig`](/api/#03-apidocs/typealiasaxaipromptconfig) & [`AxAIServiceActionOptions`](/api/#03-apidocs/typealiasaxaiserviceactionoptions)\<`TModel`, `TEmbedModel`\>\> |

#### Returns

`Promise`\<[`AxChatResponse`](/api/#03-apidocs/typealiasaxchatresponse) \| `ReadableStream`\<[`AxChatResponse`](/api/#03-apidocs/typealiasaxchatresponse)\>\>

***

<a id="embed"></a>

### embed()

> **embed**(`req`, `options`?): `Promise`\<[`AxEmbedResponse`](/api/#03-apidocs/typealiasaxembedresponse)\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/types.ts#L259

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxEmbedRequest`](/api/#03-apidocs/typealiasaxembedrequest)\<`TEmbedModel`\>\> |
| `options`? | `Readonly`\<[`AxAIServiceActionOptions`](/api/#03-apidocs/typealiasaxaiserviceactionoptions)\<`TModel`, `TEmbedModel`\>\> |

#### Returns

`Promise`\<[`AxEmbedResponse`](/api/#03-apidocs/typealiasaxembedresponse)\>

***

<a id="getDefaultModels"></a>

### getDefaultModels()

> **getDefaultModels**(): `Readonly`\<\{ `embedModel`: `string`; `model`: `string`; \}\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/types.ts#L250

#### Returns

`Readonly`\<\{ `embedModel`: `string`; `model`: `string`; \}\>

***

<a id="getFeatures"></a>

### getFeatures()

> **getFeatures**(`model`?): [`AxAIFeatures`](/api/#03-apidocs/interfaceaxaifeatures)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/types.ts#L248

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `model`? | `TModel` |

#### Returns

[`AxAIFeatures`](/api/#03-apidocs/interfaceaxaifeatures)

***

<a id="getId"></a>

### getId()

> **getId**(): `string`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/types.ts#L246

#### Returns

`string`

***

<a id="getMetrics"></a>

### getMetrics()

> **getMetrics**(): [`AxAIServiceMetrics`](/api/#03-apidocs/interfaceaxaiservicemetrics)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/types.ts#L251

#### Returns

[`AxAIServiceMetrics`](/api/#03-apidocs/interfaceaxaiservicemetrics)

***

<a id="getModelList"></a>

### getModelList()

> **getModelList**(): `undefined` \| [`AxAIModelList`](/api/#03-apidocs/typealiasaxaimodellist)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/types.ts#L249

#### Returns

`undefined` \| [`AxAIModelList`](/api/#03-apidocs/typealiasaxaimodellist)

***

<a id="getName"></a>

### getName()

> **getName**(): `string`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/types.ts#L247

#### Returns

`string`

***

<a id="getOptions"></a>

### getOptions()

> **getOptions**(): `Readonly`\<[`AxAIServiceOptions`](/api/#03-apidocs/typealiasaxaiserviceoptions)\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/types.ts#L265

#### Returns

`Readonly`\<[`AxAIServiceOptions`](/api/#03-apidocs/typealiasaxaiserviceoptions)\>

***

<a id="setOptions"></a>

### setOptions()

> **setOptions**(`options`): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/types.ts#L264

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | `Readonly`\<[`AxAIServiceOptions`](/api/#03-apidocs/typealiasaxaiserviceoptions)\> |

#### Returns

`void`
