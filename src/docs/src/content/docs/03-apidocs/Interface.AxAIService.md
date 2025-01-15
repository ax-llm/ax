---
title: AxAIService
---

Defined in: [src/ax/ai/types.ts:224](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaitypestsl224)

## Methods

<a id="chat"></a>

### chat()

> **chat**(`req`, `options`?): `Promise`\<[`AxChatResponse`](#apidocs/typealiasaxchatresponse) \| `ReadableStream`\<[`AxChatResponse`](#apidocs/typealiasaxchatresponse)\>\>

Defined in: [src/ax/ai/types.ts:232](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaitypestsl232)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxChatRequest`](#apidocs/typealiasaxchatrequest)\> |
| `options`? | `Readonly`\<[`AxAIPromptConfig`](#apidocs/typealiasaxaipromptconfig) & [`AxAIServiceActionOptions`](#apidocs/typealiasaxaiserviceactionoptions)\> |

#### Returns

`Promise`\<[`AxChatResponse`](#apidocs/typealiasaxchatresponse) \| `ReadableStream`\<[`AxChatResponse`](#apidocs/typealiasaxchatresponse)\>\>

***

<a id="embed"></a>

### embed()

> **embed**(`req`, `options`?): `Promise`\<[`AxEmbedResponse`](#apidocs/typealiasaxembedresponse)\>

Defined in: [src/ax/ai/types.ts:236](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaitypestsl236)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxEmbedRequest`](#apidocs/typealiasaxembedrequest)\> |
| `options`? | `Readonly`\<[`AxAIServiceActionOptions`](#apidocs/typealiasaxaiserviceactionoptions)\> |

#### Returns

`Promise`\<[`AxEmbedResponse`](#apidocs/typealiasaxembedresponse)\>

***

<a id="getEmbedModelInfo"></a>

### getEmbedModelInfo()

> **getEmbedModelInfo**(): `undefined` \| `Readonly`\<[`AxModelInfoWithProvider`](#apidocs/typealiasaxmodelinfowithprovider)\>

Defined in: [src/ax/ai/types.ts:227](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaitypestsl227)

#### Returns

`undefined` \| `Readonly`\<[`AxModelInfoWithProvider`](#apidocs/typealiasaxmodelinfowithprovider)\>

***

<a id="getFeatures"></a>

### getFeatures()

> **getFeatures**(`model`?): `object`

Defined in: [src/ax/ai/types.ts:228](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaitypestsl228)

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

***

<a id="getMetrics"></a>

### getMetrics()

> **getMetrics**(): [`AxAIServiceMetrics`](#apidocs/interfaceaxaiservicemetrics)

Defined in: [src/ax/ai/types.ts:230](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaitypestsl230)

#### Returns

[`AxAIServiceMetrics`](#apidocs/interfaceaxaiservicemetrics)

***

<a id="getModelInfo"></a>

### getModelInfo()

> **getModelInfo**(): `Readonly`\<[`AxModelInfoWithProvider`](#apidocs/typealiasaxmodelinfowithprovider)\>

Defined in: [src/ax/ai/types.ts:226](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaitypestsl226)

#### Returns

`Readonly`\<[`AxModelInfoWithProvider`](#apidocs/typealiasaxmodelinfowithprovider)\>

***

<a id="getModelMap"></a>

### getModelMap()

> **getModelMap**(): `undefined` \| [`AxAIModelMap`](#apidocs/typealiasaxaimodelmap)

Defined in: [src/ax/ai/types.ts:229](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaitypestsl229)

#### Returns

`undefined` \| [`AxAIModelMap`](#apidocs/typealiasaxaimodelmap)

***

<a id="getName"></a>

### getName()

> **getName**(): `string`

Defined in: [src/ax/ai/types.ts:225](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaitypestsl225)

#### Returns

`string`

***

<a id="setOptions"></a>

### setOptions()

> **setOptions**(`options`): `void`

Defined in: [src/ax/ai/types.ts:241](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaitypestsl241)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | `Readonly`\<[`AxAIServiceOptions`](#apidocs/typealiasaxaiserviceoptions)\> |

#### Returns

`void`
