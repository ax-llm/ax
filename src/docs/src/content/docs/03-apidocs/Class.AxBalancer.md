---
title: AxBalancer
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/balance.ts#L40

Balancer that rotates through services.

## Implements

- [`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)\<`unknown`, `unknown`\>

## Constructors

<a id="constructors"></a>

### new AxBalancer()

> **new AxBalancer**(`services`, `options`?): [`AxBalancer`](/api/#03-apidocs/classaxbalancer)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/balance.ts#L53

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `services` | readonly [`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)\<`unknown`, `unknown`\>[] |
| `options`? | [`AxBalancerOptions`](/api/#03-apidocs/typealiasaxbalanceroptions) |

#### Returns

[`AxBalancer`](/api/#03-apidocs/classaxbalancer)

## Methods

<a id="chat"></a>

### chat()

> **chat**(`req`, `options`?): `Promise`\<[`AxChatResponse`](/api/#03-apidocs/typealiasaxchatresponse) \| `ReadableStream`\<[`AxChatResponse`](/api/#03-apidocs/typealiasaxchatresponse)\>\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/balance.ts#L194

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

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/balance.ts#L254

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

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/balance.ts#L110

#### Returns

`Readonly`\<\{ `embedModel`: `string`; `model`: `string`; \}\>

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`getDefaultModels`](/api/#03-apidocs/interfaceaxaiservicemdgetdefaultmodels)

***

<a id="getFeatures"></a>

### getFeatures()

> **getFeatures**(`model`?): [`AxAIFeatures`](/api/#03-apidocs/interfaceaxaifeatures)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/balance.ts#L140

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `model`? | `string` |

#### Returns

[`AxAIFeatures`](/api/#03-apidocs/interfaceaxaifeatures)

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`getFeatures`](/api/#03-apidocs/interfaceaxaiservicemdgetfeatures)

***

<a id="getId"></a>

### getId()

> **getId**(): `string`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/balance.ts#L136

#### Returns

`string`

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`getId`](/api/#03-apidocs/interfaceaxaiservicemdgetid)

***

<a id="getMetrics"></a>

### getMetrics()

> **getMetrics**(): [`AxAIServiceMetrics`](/api/#03-apidocs/interfaceaxaiservicemetrics)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/balance.ts#L144

#### Returns

[`AxAIServiceMetrics`](/api/#03-apidocs/interfaceaxaiservicemetrics)

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`getMetrics`](/api/#03-apidocs/interfaceaxaiservicemdgetmetrics)

***

<a id="getModelList"></a>

### getModelList()

> **getModelList**(): `undefined` \| [`AxAIModelList`](/api/#03-apidocs/typealiasaxaimodellist)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/balance.ts#L106

#### Returns

`undefined` \| [`AxAIModelList`](/api/#03-apidocs/typealiasaxaimodellist)

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`getModelList`](/api/#03-apidocs/interfaceaxaiservicemdgetmodellist)

***

<a id="getName"></a>

### getName()

> **getName**(): `string`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/balance.ts#L132

#### Returns

`string`

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`getName`](/api/#03-apidocs/interfaceaxaiservicemdgetname)

***

<a id="getOptions"></a>

### getOptions()

> **getOptions**(): `Readonly`\<[`AxAIServiceOptions`](/api/#03-apidocs/typealiasaxaiserviceoptions)\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/balance.ts#L284

#### Returns

`Readonly`\<[`AxAIServiceOptions`](/api/#03-apidocs/typealiasaxaiserviceoptions)\>

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`getOptions`](/api/#03-apidocs/interfaceaxaiservicemdgetoptions)

***

<a id="setOptions"></a>

### setOptions()

> **setOptions**(`options`): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/balance.ts#L280

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | `Readonly`\<[`AxAIServiceOptions`](/api/#03-apidocs/typealiasaxaiserviceoptions)\> |

#### Returns

`void`

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`setOptions`](/api/#03-apidocs/interfaceaxaiservicemdsetoptions)

***

<a id="inputOrderComparator"></a>

### inputOrderComparator()

> `static` **inputOrderComparator**(): `number`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/balance.ts#L78

Service comparator that respects the input order of services.

#### Returns

`number`

***

<a id="metricComparator"></a>

### metricComparator()

> `static` **metricComparator**(`a`, `b`): `number`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/balance.ts#L99

Service comparator that sorts services by cost.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `a` | [`AxAIService`](/api/#03-apidocs/interfaceaxaiservice) |
| `b` | [`AxAIService`](/api/#03-apidocs/interfaceaxaiservice) |

#### Returns

`number`
