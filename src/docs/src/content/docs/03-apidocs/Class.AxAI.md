---
title: AxAI
---

Defined in: [src/ax/ai/wrap.ts:80](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaiwraptsl80)

## Implements

- [`AxAIService`](#apidocs/interfaceaxaiservice)

## Constructors

<a id="Constructors"></a>

### new AxAI()

> **new AxAI**(`options`): [`AxAI`](#apidocs/classaxai)

Defined in: [src/ax/ai/wrap.ts:83](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaiwraptsl83)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | `Readonly`\<[`AxAIArgs`](#apidocs/typealiasaxaiargs)\> |

#### Returns

[`AxAI`](#apidocs/classaxai)

## Methods

<a id="chat"></a>

### chat()

> **chat**(`req`, `options`?): `Promise`\<[`AxChatResponse`](#apidocs/typealiasaxchatresponse) \| `ReadableStream`\<[`AxChatResponse`](#apidocs/typealiasaxchatresponse)\>\>

Defined in: [src/ax/ai/wrap.ts:150](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaiwraptsl150)

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

Defined in: [src/ax/ai/wrap.ts:157](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaiwraptsl157)

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

Defined in: [src/ax/ai/wrap.ts:134](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaiwraptsl134)

#### Returns

`undefined` \| `Readonly`\<[`AxModelInfoWithProvider`](#apidocs/typealiasaxmodelinfowithprovider)\>

#### Implementation of

[`AxAIService`](#apidocs/interfaceaxaiservice).[`getEmbedModelInfo`](#apidocs/interfaceaxaiservicemdgetembedmodelinfo)

***

<a id="getFeatures"></a>

### getFeatures()

> **getFeatures**(`model`?): `object`

Defined in: [src/ax/ai/wrap.ts:138](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaiwraptsl138)

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

Defined in: [src/ax/ai/wrap.ts:146](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaiwraptsl146)

#### Returns

[`AxAIServiceMetrics`](#apidocs/interfaceaxaiservicemetrics)

#### Implementation of

[`AxAIService`](#apidocs/interfaceaxaiservice).[`getMetrics`](#apidocs/interfaceaxaiservicemdgetmetrics)

***

<a id="getModelInfo"></a>

### getModelInfo()

> **getModelInfo**(): `Readonly`\<[`AxModelInfoWithProvider`](#apidocs/typealiasaxmodelinfowithprovider)\>

Defined in: [src/ax/ai/wrap.ts:130](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaiwraptsl130)

#### Returns

`Readonly`\<[`AxModelInfoWithProvider`](#apidocs/typealiasaxmodelinfowithprovider)\>

#### Implementation of

[`AxAIService`](#apidocs/interfaceaxaiservice).[`getModelInfo`](#apidocs/interfaceaxaiservicemdgetmodelinfo)

***

<a id="getModelMap"></a>

### getModelMap()

> **getModelMap**(): `undefined` \| [`AxAIModelMap`](#apidocs/typealiasaxaimodelmap)

Defined in: [src/ax/ai/wrap.ts:142](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaiwraptsl142)

#### Returns

`undefined` \| [`AxAIModelMap`](#apidocs/typealiasaxaimodelmap)

#### Implementation of

[`AxAIService`](#apidocs/interfaceaxaiservice).[`getModelMap`](#apidocs/interfaceaxaiservicemdgetmodelmap)

***

<a id="getName"></a>

### getName()

> **getName**(): `string`

Defined in: [src/ax/ai/wrap.ts:126](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaiwraptsl126)

#### Returns

`string`

#### Implementation of

[`AxAIService`](#apidocs/interfaceaxaiservice).[`getName`](#apidocs/interfaceaxaiservicemdgetname)

***

<a id="setOptions"></a>

### setOptions()

> **setOptions**(`options`): `void`

Defined in: [src/ax/ai/wrap.ts:164](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaiwraptsl164)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | `Readonly`\<[`AxAIServiceOptions`](#apidocs/typealiasaxaiserviceoptions)\> |

#### Returns

`void`

#### Implementation of

[`AxAIService`](#apidocs/interfaceaxaiservice).[`setOptions`](#apidocs/interfaceaxaiservicemdsetoptions)
