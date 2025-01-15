---
title: AxBaseAI
---

Defined in: [src/ax/ai/base.ts:64](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaibasetsl64)

## Extended by

- [`AxAIAnthropic`](#apidocs/classaxaianthropic)
- [`AxAICohere`](#apidocs/classaxaicohere)
- [`AxAIGoogleGemini`](#apidocs/classaxaigooglegemini)
- [`AxAIHuggingFace`](#apidocs/classaxaihuggingface)
- [`AxAIOpenAI`](#apidocs/classaxaiopenai)
- [`AxAIReka`](#apidocs/classaxaireka)

## Type Parameters

| Type Parameter |
| ------ |
| `TChatRequest` |
| `TEmbedRequest` |
| `TChatResponse` |
| `TChatResponseDelta` |
| `TEmbedResponse` |

## Implements

- [`AxAIService`](#apidocs/interfaceaxaiservice)

## Constructors

<a id="Constructors"></a>

### new AxBaseAI()

> **new AxBaseAI**\<`TChatRequest`, `TEmbedRequest`, `TChatResponse`, `TChatResponseDelta`, `TEmbedResponse`\>(`aiImpl`, `__namedParameters`): [`AxBaseAI`](#apidocs/classaxbaseai)\<`TChatRequest`, `TEmbedRequest`, `TChatResponse`, `TChatResponseDelta`, `TEmbedResponse`\>

Defined in: [src/ax/ai/base.ts:119](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaibasetsl119)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `aiImpl` | `Readonly`\<[`AxAIServiceImpl`](#apidocs/interfaceaxaiserviceimpl)\<`TChatRequest`, `TEmbedRequest`, `TChatResponse`, `TChatResponseDelta`, `TEmbedResponse`\>\> |
| `__namedParameters` | `Readonly`\<[`AxBaseAIArgs`](#apidocs/interfaceaxbaseaiargs)\> |

#### Returns

[`AxBaseAI`](#apidocs/classaxbaseai)\<`TChatRequest`, `TEmbedRequest`, `TChatResponse`, `TChatResponseDelta`, `TEmbedResponse`\>

## Methods

<a id="chat"></a>

### chat()

> **chat**(`req`, `options`?): `Promise`\<[`AxChatResponse`](#apidocs/typealiasaxchatresponse) \| `ReadableStream`\<[`AxChatResponse`](#apidocs/typealiasaxchatresponse)\>\>

Defined in: [src/ax/ai/base.ts:278](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaibasetsl278)

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

Defined in: [src/ax/ai/base.ts:468](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaibasetsl468)

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

> **getEmbedModelInfo**(): `undefined` \| [`AxModelInfoWithProvider`](#apidocs/typealiasaxmodelinfowithprovider)

Defined in: [src/ax/ai/base.ts:205](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaibasetsl205)

#### Returns

`undefined` \| [`AxModelInfoWithProvider`](#apidocs/typealiasaxmodelinfowithprovider)

#### Implementation of

[`AxAIService`](#apidocs/interfaceaxaiservice).[`getEmbedModelInfo`](#apidocs/interfaceaxaiservicemdgetembedmodelinfo)

***

<a id="getFeatures"></a>

### getFeatures()

> **getFeatures**(`model`?): [`AxBaseAIFeatures`](#apidocs/interfaceaxbaseaifeatures)

Defined in: [src/ax/ai/base.ts:229](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaibasetsl229)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `model`? | `string` |

#### Returns

[`AxBaseAIFeatures`](#apidocs/interfaceaxbaseaifeatures)

#### Implementation of

[`AxAIService`](#apidocs/interfaceaxaiservice).[`getFeatures`](#apidocs/interfaceaxaiservicemdgetfeatures)

***

<a id="getMetrics"></a>

### getMetrics()

> **getMetrics**(): [`AxAIServiceMetrics`](#apidocs/interfaceaxaiservicemetrics)

Defined in: [src/ax/ai/base.ts:274](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaibasetsl274)

#### Returns

[`AxAIServiceMetrics`](#apidocs/interfaceaxaiservicemetrics)

#### Implementation of

[`AxAIService`](#apidocs/interfaceaxaiservice).[`getMetrics`](#apidocs/interfaceaxaiservicemdgetmetrics)

***

<a id="getModelInfo"></a>

### getModelInfo()

> **getModelInfo**(): `Readonly`\<[`AxModelInfoWithProvider`](#apidocs/typealiasaxmodelinfowithprovider)\>

Defined in: [src/ax/ai/base.ts:193](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaibasetsl193)

#### Returns

`Readonly`\<[`AxModelInfoWithProvider`](#apidocs/typealiasaxmodelinfowithprovider)\>

#### Implementation of

[`AxAIService`](#apidocs/interfaceaxaiservice).[`getModelInfo`](#apidocs/interfaceaxaiservicemdgetmodelinfo)

***

<a id="getModelMap"></a>

### getModelMap()

> **getModelMap**(): `undefined` \| [`AxAIModelMap`](#apidocs/typealiasaxaimodelmap)

Defined in: [src/ax/ai/base.ts:221](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaibasetsl221)

#### Returns

`undefined` \| [`AxAIModelMap`](#apidocs/typealiasaxaimodelmap)

#### Implementation of

[`AxAIService`](#apidocs/interfaceaxaiservice).[`getModelMap`](#apidocs/interfaceaxaiservicemdgetmodelmap)

***

<a id="getName"></a>

### getName()

> **getName**(): `string`

Defined in: [src/ax/ai/base.ts:225](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaibasetsl225)

#### Returns

`string`

#### Implementation of

[`AxAIService`](#apidocs/interfaceaxaiservice).[`getName`](#apidocs/interfaceaxaiservicemdgetname)

***

<a id="setAPIURL"></a>

### setAPIURL()

> **setAPIURL**(`apiURL`): `void`

Defined in: [src/ax/ai/base.ts:167](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaibasetsl167)

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

Defined in: [src/ax/ai/base.ts:171](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaibasetsl171)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `headers` | `Record`\<`string`, `string`\> |

#### Returns

`void`

***

<a id="setName"></a>

### setName()

> **setName**(`name`): `void`

Defined in: [src/ax/ai/base.ts:163](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaibasetsl163)

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

Defined in: [src/ax/ai/base.ts:175](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaibasetsl175)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | `Readonly`\<[`AxAIServiceOptions`](#apidocs/typealiasaxaiserviceoptions)\> |

#### Returns

`void`

#### Implementation of

[`AxAIService`](#apidocs/interfaceaxaiservice).[`setOptions`](#apidocs/interfaceaxaiservicemdsetoptions)
