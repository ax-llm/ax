---
title: AxAIReka
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/reka/api.ts#L266

## Extends

- [`AxBaseAI`](/api/#03-apidocs/classaxbaseai)\<[`AxAIRekaModel`](/api/#03-apidocs/enumerationaxairekamodel), `undefined`, [`AxAIRekaChatRequest`](/api/#03-apidocs/typealiasaxairekachatrequest), `unknown`, [`AxAIRekaChatResponse`](/api/#03-apidocs/typealiasaxairekachatresponse), [`AxAIRekaChatResponseDelta`](/api/#03-apidocs/typealiasaxairekachatresponsedelta), `unknown`\>

## Constructors

<a id="constructors"></a>

### new AxAIReka()

> **new AxAIReka**(`__namedParameters`): [`AxAIReka`](/api/#03-apidocs/classaxaireka)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/reka/api.ts#L275

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `__namedParameters` | `Readonly`\<`Omit`\<[`AxAIRekaArgs`](/api/#03-apidocs/interfaceaxairekaargs), `"name"`\>\> |

#### Returns

[`AxAIReka`](/api/#03-apidocs/classaxaireka)

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
| `req` | `Readonly`\<[`AxChatRequest`](/api/#03-apidocs/typealiasaxchatrequest)\<[`AxAIRekaModel`](/api/#03-apidocs/enumerationaxairekamodel)\>\> |
| `options`? | `Readonly`\<[`AxAIPromptConfig`](/api/#03-apidocs/typealiasaxaipromptconfig) & [`AxAIServiceActionOptions`](/api/#03-apidocs/typealiasaxaiserviceactionoptions)\<[`AxAIRekaModel`](/api/#03-apidocs/enumerationaxairekamodel), `undefined`\>\> |

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
| `req` | `Readonly`\<[`AxEmbedRequest`](/api/#03-apidocs/typealiasaxembedrequest)\<`undefined`\>\> |
| `options`? | `Readonly`\<[`AxAIServiceActionOptions`](/api/#03-apidocs/typealiasaxaiserviceactionoptions)\<[`AxAIRekaModel`](/api/#03-apidocs/enumerationaxairekamodel), `undefined`\>\> |

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
| `model`? | [`AxAIRekaModel`](/api/#03-apidocs/enumerationaxairekamodel) |

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
