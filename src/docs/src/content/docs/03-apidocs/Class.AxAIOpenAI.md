---
title: AxAIOpenAI
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/openai/api.ts#L479

## Extends

- [`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase)\<[`AxAIOpenAIModel`](/api/#03-apidocs/enumerationaxaiopenaimodel), [`AxAIOpenAIEmbedModel`](/api/#03-apidocs/enumerationaxaiopenaiembedmodel)\>

## Constructors

<a id="constructors"></a>

### new AxAIOpenAI()

> **new AxAIOpenAI**(`__namedParameters`): [`AxAIOpenAI`](/api/#03-apidocs/classaxaiopenai)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/openai/api.ts#L483

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `__namedParameters` | `Readonly`\<`Omit`\<[`AxAIOpenAIArgs`](/api/#03-apidocs/interfaceaxaiopenaiargs)\<`"openai"`, [`AxAIOpenAIModel`](/api/#03-apidocs/enumerationaxaiopenaimodel), [`AxAIOpenAIEmbedModel`](/api/#03-apidocs/enumerationaxaiopenaiembedmodel)\>, `"name"` \| `"modelInfo"`\>\> |

#### Returns

[`AxAIOpenAI`](/api/#03-apidocs/classaxaiopenai)

#### Overrides

[`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase).[`constructor`](/api/#03-apidocs/classaxaiopenaibasemdconstructors)

## Methods

<a id="chat"></a>

### chat()

> **chat**(`req`, `options`?): `Promise`\<[`AxChatResponse`](/api/#03-apidocs/typealiasaxchatresponse) \| `ReadableStream`\<[`AxChatResponse`](/api/#03-apidocs/typealiasaxchatresponse)\>\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L290

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxChatRequest`](/api/#03-apidocs/typealiasaxchatrequest)\<[`AxAIOpenAIModel`](/api/#03-apidocs/enumerationaxaiopenaimodel)\>\> |
| `options`? | `Readonly`\<[`AxAIPromptConfig`](/api/#03-apidocs/typealiasaxaipromptconfig) & [`AxAIServiceActionOptions`](/api/#03-apidocs/typealiasaxaiserviceactionoptions)\<[`AxAIOpenAIModel`](/api/#03-apidocs/enumerationaxaiopenaimodel), [`AxAIOpenAIEmbedModel`](/api/#03-apidocs/enumerationaxaiopenaiembedmodel)\>\> |

#### Returns

`Promise`\<[`AxChatResponse`](/api/#03-apidocs/typealiasaxchatresponse) \| `ReadableStream`\<[`AxChatResponse`](/api/#03-apidocs/typealiasaxchatresponse)\>\>

#### Inherited from

[`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase).[`chat`](/api/#03-apidocs/classaxaiopenaibasemdchat)

***

<a id="embed"></a>

### embed()

> **embed**(`req`, `options`?): `Promise`\<[`AxEmbedResponse`](/api/#03-apidocs/typealiasaxembedresponse)\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L524

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxEmbedRequest`](/api/#03-apidocs/typealiasaxembedrequest)\<[`AxAIOpenAIEmbedModel`](/api/#03-apidocs/enumerationaxaiopenaiembedmodel)\>\> |
| `options`? | `Readonly`\<[`AxAIServiceActionOptions`](/api/#03-apidocs/typealiasaxaiserviceactionoptions)\<[`AxAIOpenAIModel`](/api/#03-apidocs/enumerationaxaiopenaimodel), [`AxAIOpenAIEmbedModel`](/api/#03-apidocs/enumerationaxaiopenaiembedmodel)\>\> |

#### Returns

`Promise`\<[`AxEmbedResponse`](/api/#03-apidocs/typealiasaxembedresponse)\>

#### Inherited from

[`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase).[`embed`](/api/#03-apidocs/classaxaiopenaibasemdembed)

***

<a id="getDefaultModels"></a>

### getDefaultModels()

> **getDefaultModels**(): `Readonly`\<\{ `embedModel`: `string`; `model`: `string`; \}\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L230

#### Returns

`Readonly`\<\{ `embedModel`: `string`; `model`: `string`; \}\>

#### Inherited from

[`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase).[`getDefaultModels`](/api/#03-apidocs/classaxaiopenaibasemdgetdefaultmodels)

***

<a id="getFeatures"></a>

### getFeatures()

> **getFeatures**(`model`?): [`AxAIFeatures`](/api/#03-apidocs/interfaceaxaifeatures)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L241

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `model`? | [`AxAIOpenAIModel`](/api/#03-apidocs/enumerationaxaiopenaimodel) |

#### Returns

[`AxAIFeatures`](/api/#03-apidocs/interfaceaxaifeatures)

#### Inherited from

[`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase).[`getFeatures`](/api/#03-apidocs/classaxaiopenaibasemdgetfeatures)

***

<a id="getId"></a>

### getId()

> **getId**(): `string`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L181

#### Returns

`string`

#### Inherited from

[`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase).[`getId`](/api/#03-apidocs/classaxaiopenaibasemdgetid)

***

<a id="getMetrics"></a>

### getMetrics()

> **getMetrics**(): [`AxAIServiceMetrics`](/api/#03-apidocs/interfaceaxaiservicemetrics)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L286

#### Returns

[`AxAIServiceMetrics`](/api/#03-apidocs/interfaceaxaiservicemetrics)

#### Inherited from

[`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase).[`getMetrics`](/api/#03-apidocs/classaxaiopenaibasemdgetmetrics)

***

<a id="getModelList"></a>

### getModelList()

> **getModelList**(): `undefined` \| [`AxAIModelList`](/api/#03-apidocs/typealiasaxaimodellist)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L220

#### Returns

`undefined` \| [`AxAIModelList`](/api/#03-apidocs/typealiasaxaimodellist)

#### Inherited from

[`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase).[`getModelList`](/api/#03-apidocs/classaxaiopenaibasemdgetmodellist)

***

<a id="getName"></a>

### getName()

> **getName**(): `string`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L237

#### Returns

`string`

#### Inherited from

[`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase).[`getName`](/api/#03-apidocs/classaxaiopenaibasemdgetname)

***

<a id="getOptions"></a>

### getOptions()

> **getOptions**(): `Readonly`\<[`AxAIServiceOptions`](/api/#03-apidocs/typealiasaxaiserviceoptions)\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L211

#### Returns

`Readonly`\<[`AxAIServiceOptions`](/api/#03-apidocs/typealiasaxaiserviceoptions)\>

#### Inherited from

[`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase).[`getOptions`](/api/#03-apidocs/classaxaiopenaibasemdgetoptions)

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

[`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase).[`setAPIURL`](/api/#03-apidocs/classaxaiopenaibasemdsetapiurl)

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

[`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase).[`setHeaders`](/api/#03-apidocs/classaxaiopenaibasemdsetheaders)

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

[`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase).[`setName`](/api/#03-apidocs/classaxaiopenaibasemdsetname)

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

[`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase).[`setOptions`](/api/#03-apidocs/classaxaiopenaibasemdsetoptions)
