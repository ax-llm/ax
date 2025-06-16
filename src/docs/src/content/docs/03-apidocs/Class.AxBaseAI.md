---
title: AxBaseAI
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L72

## Extended by

- [`AxAIAnthropic`](/api/#03-apidocs/classaxaianthropic)
- [`AxAICohere`](/api/#03-apidocs/classaxaicohere)
- [`AxAIGoogleGemini`](/api/#03-apidocs/classaxaigooglegemini)
- [`AxAIHuggingFace`](/api/#03-apidocs/classaxaihuggingface)
- [`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase)
- [`AxAIOpenAIResponsesBase`](/api/#03-apidocs/classaxaiopenairesponsesbase)
- [`AxAIReka`](/api/#03-apidocs/classaxaireka)

## Type Parameters

| Type Parameter |
| :------ |
| `TModel` |
| `TEmbedModel` |
| `TChatRequest` |
| `TEmbedRequest` |
| `TChatResponse` |
| `TChatResponseDelta` |
| `TEmbedResponse` |

## Implements

- [`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)\<`TModel`, `TEmbedModel`\>

## Constructors

<a id="constructors"></a>

### new AxBaseAI()

```ts
new AxBaseAI<TModel, TEmbedModel, TChatRequest, TEmbedRequest, TChatResponse, TChatResponseDelta, TEmbedResponse>(aiImpl: Readonly<AxAIServiceImpl<TModel, TEmbedModel, TChatRequest, TEmbedRequest, TChatResponse, TChatResponseDelta, TEmbedResponse>>, __namedParameters: Readonly<AxBaseAIArgs<TModel, TEmbedModel>>): AxBaseAI<TModel, TEmbedModel, TChatRequest, TEmbedRequest, TChatResponse, TChatResponseDelta, TEmbedResponse>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L137

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `aiImpl` | `Readonly`\<[`AxAIServiceImpl`](/api/#03-apidocs/interfaceaxaiserviceimpl)\<`TModel`, `TEmbedModel`, `TChatRequest`, `TEmbedRequest`, `TChatResponse`, `TChatResponseDelta`, `TEmbedResponse`\>\> |
| `__namedParameters` | `Readonly`\<[`AxBaseAIArgs`](/api/#03-apidocs/interfaceaxbaseaiargs)\<`TModel`, `TEmbedModel`\>\> |

#### Returns

[`AxBaseAI`](/api/#03-apidocs/classaxbaseai)\<`TModel`, `TEmbedModel`, `TChatRequest`, `TEmbedRequest`, `TChatResponse`, `TChatResponseDelta`, `TEmbedResponse`\>

## Methods

<a id="chat"></a>

### chat()

```ts
chat(req: Readonly<AxChatRequest<TModel>>, options?: Readonly<AxAIPromptConfig & AxAIServiceActionOptions<TModel, TEmbedModel>>): Promise<
  | AxChatResponse
| ReadableStream<AxChatResponse>>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L326

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `req` | `Readonly`\<[`AxChatRequest`](/api/#03-apidocs/typealiasaxchatrequest)\<`TModel`\>\> |
| `options`? | `Readonly`\<[`AxAIPromptConfig`](/api/#03-apidocs/typealiasaxaipromptconfig) & [`AxAIServiceActionOptions`](/api/#03-apidocs/typealiasaxaiserviceactionoptions)\<`TModel`, `TEmbedModel`\>\> |

#### Returns

`Promise`\<
  \| [`AxChatResponse`](/api/#03-apidocs/typealiasaxchatresponse)
  \| `ReadableStream`\<[`AxChatResponse`](/api/#03-apidocs/typealiasaxchatresponse)\>\>

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`chat`](/api/#03-apidocs/interfaceaxaiservicemdchat)

***

<a id="embed"></a>

### embed()

```ts
embed(req: Readonly<AxEmbedRequest<TEmbedModel>>, options?: Readonly<AxAIServiceActionOptions<TModel, TEmbedModel>>): Promise<AxEmbedResponse>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L614

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `req` | `Readonly`\<[`AxEmbedRequest`](/api/#03-apidocs/typealiasaxembedrequest)\<`TEmbedModel`\>\> |
| `options`? | `Readonly`\<[`AxAIServiceActionOptions`](/api/#03-apidocs/typealiasaxaiserviceactionoptions)\<`TModel`, `TEmbedModel`\>\> |

#### Returns

`Promise`\<[`AxEmbedResponse`](/api/#03-apidocs/typealiasaxembedresponse)\>

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`embed`](/api/#03-apidocs/interfaceaxaiservicemdembed)

***

<a id="getFeatures"></a>

### getFeatures()

```ts
getFeatures(model?: TModel): AxAIFeatures
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L265

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `model`? | `TModel` |

#### Returns

[`AxAIFeatures`](/api/#03-apidocs/interfaceaxaifeatures)

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`getFeatures`](/api/#03-apidocs/interfaceaxaiservicemdgetfeatures)

***

<a id="getId"></a>

### getId()

```ts
getId(): string
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L194

#### Returns

`string`

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`getId`](/api/#03-apidocs/interfaceaxaiservicemdgetid)

***

<a id="getLastUsedChatModel"></a>

### getLastUsedChatModel()

```ts
getLastUsedChatModel(): undefined | TModel
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L271

#### Returns

`undefined` \| `TModel`

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`getLastUsedChatModel`](/api/#03-apidocs/interfaceaxaiservicemdgetlastusedchatmodel)

***

<a id="getLastUsedEmbedModel"></a>

### getLastUsedEmbedModel()

```ts
getLastUsedEmbedModel(): undefined | TEmbedModel
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L275

#### Returns

`undefined` \| `TEmbedModel`

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`getLastUsedEmbedModel`](/api/#03-apidocs/interfaceaxaiservicemdgetlastusedembedmodel)

***

<a id="getLastUsedModelConfig"></a>

### getLastUsedModelConfig()

```ts
getLastUsedModelConfig(): undefined | AxModelConfig
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L279

#### Returns

`undefined` \| [`AxModelConfig`](/api/#03-apidocs/typealiasaxmodelconfig)

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`getLastUsedModelConfig`](/api/#03-apidocs/interfaceaxaiservicemdgetlastusedmodelconfig)

***

<a id="getLogger"></a>

### getLogger()

```ts
getLogger(): AxLoggerFunction
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L230

#### Returns

[`AxLoggerFunction`](/api/#03-apidocs/typealiasaxloggerfunction)

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`getLogger`](/api/#03-apidocs/interfaceaxaiservicemdgetlogger)

***

<a id="getMetrics"></a>

### getMetrics()

```ts
getMetrics(): AxAIServiceMetrics
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L322

#### Returns

[`AxAIServiceMetrics`](/api/#03-apidocs/interfaceaxaiservicemetrics)

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`getMetrics`](/api/#03-apidocs/interfaceaxaiservicemdgetmetrics)

***

<a id="getModelList"></a>

### getModelList()

```ts
getModelList(): undefined | AxAIModelList
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L234

#### Returns

`undefined` \| [`AxAIModelList`](/api/#03-apidocs/typealiasaxaimodellist)

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`getModelList`](/api/#03-apidocs/interfaceaxaiservicemdgetmodellist)

***

<a id="getName"></a>

### getName()

```ts
getName(): string
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L261

#### Returns

`string`

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`getName`](/api/#03-apidocs/interfaceaxaiservicemdgetname)

***

<a id="getOptions"></a>

### getOptions()

```ts
getOptions(): Readonly<AxAIServiceOptions>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L217

#### Returns

`Readonly`\<[`AxAIServiceOptions`](/api/#03-apidocs/typealiasaxaiserviceoptions)\>

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`getOptions`](/api/#03-apidocs/interfaceaxaiservicemdgetoptions)

***

<a id="setAPIURL"></a>

### setAPIURL()

```ts
setAPIURL(apiURL: string): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L198

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `apiURL` | `string` |

#### Returns

`void`

***

<a id="setHeaders"></a>

### setHeaders()

```ts
setHeaders(headers: () => Promise<Record<string, string>>): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L202

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `headers` | () => `Promise`\<`Record`\<`string`, `string`\>\> |

#### Returns

`void`

***

<a id="setName"></a>

### setName()

```ts
setName(name: string): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L190

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

`void`

***

<a id="setOptions"></a>

### setOptions()

```ts
setOptions(options: Readonly<AxAIServiceOptions>): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L206

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `options` | `Readonly`\<[`AxAIServiceOptions`](/api/#03-apidocs/typealiasaxaiserviceoptions)\> |

#### Returns

`void`

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`setOptions`](/api/#03-apidocs/interfaceaxaiservicemdsetoptions)
