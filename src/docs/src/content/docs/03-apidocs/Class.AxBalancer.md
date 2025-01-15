---
title: AxBalancer
---

Defined in: [src/ax/ai/balance.ts:47](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaibalancetsl47)

Balancer that rotates through services.

## Implements

- [`AxAIService`](#apidocs/interfaceaxaiservice)

## Constructors

<a id="Constructors"></a>

### new AxBalancer()

> **new AxBalancer**(`services`, `options`?): [`AxBalancer`](#apidocs/classaxbalancer)

Defined in: [src/ax/ai/balance.ts:52](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaibalancetsl52)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `services` | readonly [`AxAIService`](#apidocs/interfaceaxaiservice)[] |
| `options`? | [`AxBalancerOptions`](#apidocs/typealiasaxbalanceroptions) |

#### Returns

[`AxBalancer`](#apidocs/classaxbalancer)

## Methods

<a id="chat"></a>

### chat()

> **chat**(`req`, `options`?): `Promise`\<[`AxChatResponse`](#apidocs/typealiasaxchatresponse) \| `ReadableStream`\<[`AxChatResponse`](#apidocs/typealiasaxchatresponse)\>\>

Defined in: [src/ax/ai/balance.ts:108](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaibalancetsl108)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxChatRequest`](#apidocs/typealiasaxchatrequest)\> |
| `options`? | `Readonly`\<[`AxAIPromptConfig`](#apidocs/typealiasaxaipromptconfig) & [`AxAIServiceActionOptions`](#apidocs/typealiasaxaiserviceactionoptions)\> |

#### Returns

`Promise`\<[`AxChatResponse`](#apidocs/typealiasaxchatresponse) \| `ReadableStream`\<[`AxChatResponse`](#apidocs/typealiasaxchatresponse)\>\>

#### Implementation of

[`AxAIService`](#apidocs/interfaceaxaiservice).[`chat`](#apidocs/interfaceaxaiservicemdchat)

***

<a id="embed"></a>

### embed()

> **embed**(`req`, `options`?): `Promise`\<[`AxEmbedResponse`](#apidocs/typealiasaxembedresponse)\>

Defined in: [src/ax/ai/balance.ts:125](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaibalancetsl125)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxEmbedRequest`](#apidocs/typealiasaxembedrequest)\> |
| `options`? | `Readonly`\<[`AxAIServiceActionOptions`](#apidocs/typealiasaxaiserviceactionoptions)\> |

#### Returns

`Promise`\<[`AxEmbedResponse`](#apidocs/typealiasaxembedresponse)\>

#### Implementation of

[`AxAIService`](#apidocs/interfaceaxaiservice).[`embed`](#apidocs/interfaceaxaiservicemdembed)

***

<a id="getEmbedModelInfo"></a>

### getEmbedModelInfo()

> **getEmbedModelInfo**(): `undefined` \| `Readonly`\<[`AxModelInfoWithProvider`](#apidocs/typealiasaxmodelinfowithprovider)\>

Defined in: [src/ax/ai/balance.ts:96](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaibalancetsl96)

#### Returns

`undefined` \| `Readonly`\<[`AxModelInfoWithProvider`](#apidocs/typealiasaxmodelinfowithprovider)\>

#### Implementation of

[`AxAIService`](#apidocs/interfaceaxaiservice).[`getEmbedModelInfo`](#apidocs/interfaceaxaiservicemdgetembedmodelinfo)

***

<a id="getFeatures"></a>

### getFeatures()

> **getFeatures**(`model`?): `object`

Defined in: [src/ax/ai/balance.ts:100](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaibalancetsl100)

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

[`AxAIService`](#apidocs/interfaceaxaiservice).[`getFeatures`](#apidocs/interfaceaxaiservicemdgetfeatures)

***

<a id="getMetrics"></a>

### getMetrics()

> **getMetrics**(): [`AxAIServiceMetrics`](#apidocs/interfaceaxaiservicemetrics)

Defined in: [src/ax/ai/balance.ts:104](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaibalancetsl104)

#### Returns

[`AxAIServiceMetrics`](#apidocs/interfaceaxaiservicemetrics)

#### Implementation of

[`AxAIService`](#apidocs/interfaceaxaiservice).[`getMetrics`](#apidocs/interfaceaxaiservicemdgetmetrics)

***

<a id="getModelInfo"></a>

### getModelInfo()

> **getModelInfo**(): `Readonly`\<[`AxModelInfoWithProvider`](#apidocs/typealiasaxmodelinfowithprovider)\>

Defined in: [src/ax/ai/balance.ts:92](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaibalancetsl92)

#### Returns

`Readonly`\<[`AxModelInfoWithProvider`](#apidocs/typealiasaxmodelinfowithprovider)\>

#### Implementation of

[`AxAIService`](#apidocs/interfaceaxaiservice).[`getModelInfo`](#apidocs/interfaceaxaiservicemdgetmodelinfo)

***

<a id="getModelMap"></a>

### getModelMap()

> **getModelMap**(): `undefined` \| [`AxAIModelMap`](#apidocs/typealiasaxaimodelmap)

Defined in: [src/ax/ai/balance.ts:66](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaibalancetsl66)

#### Returns

`undefined` \| [`AxAIModelMap`](#apidocs/typealiasaxaimodelmap)

#### Implementation of

[`AxAIService`](#apidocs/interfaceaxaiservice).[`getModelMap`](#apidocs/interfaceaxaiservicemdgetmodelmap)

***

<a id="getName"></a>

### getName()

> **getName**(): `string`

Defined in: [src/ax/ai/balance.ts:88](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaibalancetsl88)

#### Returns

`string`

#### Implementation of

[`AxAIService`](#apidocs/interfaceaxaiservice).[`getName`](#apidocs/interfaceaxaiservicemdgetname)

***

<a id="setOptions"></a>

### setOptions()

> **setOptions**(`options`): `void`

Defined in: [src/ax/ai/balance.ts:142](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaibalancetsl142)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | `Readonly`\<[`AxAIServiceOptions`](#apidocs/typealiasaxaiserviceoptions)\> |

#### Returns

`void`

#### Implementation of

[`AxAIService`](#apidocs/interfaceaxaiservice).[`setOptions`](#apidocs/interfaceaxaiservicemdsetoptions)
