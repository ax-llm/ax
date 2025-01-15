---
title: AxAIMistral
---

Defined in: [src/ax/ai/mistral/api.ts:31](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaimistralapitsl31)

## Extends

- [`AxAIOpenAI`](#apidocs/classaxaiopenai)

## Constructors

<a id="Constructors"></a>

### new AxAIMistral()

> **new AxAIMistral**(`__namedParameters`): [`AxAIMistral`](#apidocs/classaxaimistral)

Defined in: [src/ax/ai/mistral/api.ts:32](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaimistralapitsl32)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `__namedParameters` | `Readonly`\<`Omit`\<[`AxAIMistralArgs`](#apidocs/interfaceaxaimistralargs), `"name"`\>\> |

#### Returns

[`AxAIMistral`](#apidocs/classaxaimistral)

#### Overrides

[`AxAIOpenAI`](#apidocs/classaxaiopenai).[`constructor`](#apidocs/classaxaiopenaimdconstructors)

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

#### Inherited from

[`AxAIOpenAI`](#apidocs/classaxaiopenai).[`chat`](#apidocs/classaxaiopenaimdchat)

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

#### Inherited from

[`AxAIOpenAI`](#apidocs/classaxaiopenai).[`embed`](#apidocs/classaxaiopenaimdembed)

***

<a id="getEmbedModelInfo"></a>

### getEmbedModelInfo()

> **getEmbedModelInfo**(): `undefined` \| [`AxModelInfoWithProvider`](#apidocs/typealiasaxmodelinfowithprovider)

Defined in: [src/ax/ai/base.ts:205](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaibasetsl205)

#### Returns

`undefined` \| [`AxModelInfoWithProvider`](#apidocs/typealiasaxmodelinfowithprovider)

#### Inherited from

[`AxAIOpenAI`](#apidocs/classaxaiopenai).[`getEmbedModelInfo`](#apidocs/classaxaiopenaimdgetembedmodelinfo)

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

#### Inherited from

[`AxAIOpenAI`](#apidocs/classaxaiopenai).[`getFeatures`](#apidocs/classaxaiopenaimdgetfeatures)

***

<a id="getMetrics"></a>

### getMetrics()

> **getMetrics**(): [`AxAIServiceMetrics`](#apidocs/interfaceaxaiservicemetrics)

Defined in: [src/ax/ai/base.ts:274](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaibasetsl274)

#### Returns

[`AxAIServiceMetrics`](#apidocs/interfaceaxaiservicemetrics)

#### Inherited from

[`AxAIOpenAI`](#apidocs/classaxaiopenai).[`getMetrics`](#apidocs/classaxaiopenaimdgetmetrics)

***

<a id="getModelInfo"></a>

### getModelInfo()

> **getModelInfo**(): `Readonly`\<[`AxModelInfoWithProvider`](#apidocs/typealiasaxmodelinfowithprovider)\>

Defined in: [src/ax/ai/base.ts:193](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaibasetsl193)

#### Returns

`Readonly`\<[`AxModelInfoWithProvider`](#apidocs/typealiasaxmodelinfowithprovider)\>

#### Inherited from

[`AxAIOpenAI`](#apidocs/classaxaiopenai).[`getModelInfo`](#apidocs/classaxaiopenaimdgetmodelinfo)

***

<a id="getModelMap"></a>

### getModelMap()

> **getModelMap**(): `undefined` \| [`AxAIModelMap`](#apidocs/typealiasaxaimodelmap)

Defined in: [src/ax/ai/base.ts:221](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaibasetsl221)

#### Returns

`undefined` \| [`AxAIModelMap`](#apidocs/typealiasaxaimodelmap)

#### Inherited from

[`AxAIOpenAI`](#apidocs/classaxaiopenai).[`getModelMap`](#apidocs/classaxaiopenaimdgetmodelmap)

***

<a id="getName"></a>

### getName()

> **getName**(): `string`

Defined in: [src/ax/ai/base.ts:225](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaibasetsl225)

#### Returns

`string`

#### Inherited from

[`AxAIOpenAI`](#apidocs/classaxaiopenai).[`getName`](#apidocs/classaxaiopenaimdgetname)

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

#### Inherited from

[`AxAIOpenAI`](#apidocs/classaxaiopenai).[`setAPIURL`](#apidocs/classaxaiopenaimdsetapiurl)

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

#### Inherited from

[`AxAIOpenAI`](#apidocs/classaxaiopenai).[`setHeaders`](#apidocs/classaxaiopenaimdsetheaders)

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

#### Inherited from

[`AxAIOpenAI`](#apidocs/classaxaiopenai).[`setName`](#apidocs/classaxaiopenaimdsetname)

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

#### Inherited from

[`AxAIOpenAI`](#apidocs/classaxaiopenai).[`setOptions`](#apidocs/classaxaiopenaimdsetoptions)
