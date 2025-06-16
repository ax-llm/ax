---
title: AxAIGoogleGemini
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/google-gemini/api.ts#L574

AxAIGoogleGemini: AI Service

## Extends

- [`AxBaseAI`](/api/#03-apidocs/classaxbaseai)\<[`AxAIGoogleGeminiModel`](/api/#03-apidocs/enumerationaxaigooglegeminimodel), [`AxAIGoogleGeminiEmbedModel`](/api/#03-apidocs/enumerationaxaigooglegeminiembedmodel), [`AxAIGoogleGeminiChatRequest`](/api/#03-apidocs/typealiasaxaigooglegeminichatrequest), 
  \| [`AxAIGoogleGeminiBatchEmbedRequest`](/api/#03-apidocs/typealiasaxaigooglegeminibatchembedrequest)
  \| [`AxAIGoogleVertexBatchEmbedRequest`](/api/#03-apidocs/typealiasaxaigooglevertexbatchembedrequest), [`AxAIGoogleGeminiChatResponse`](/api/#03-apidocs/typealiasaxaigooglegeminichatresponse), [`AxAIGoogleGeminiChatResponseDelta`](/api/#03-apidocs/typealiasaxaigooglegeminichatresponsedelta), 
  \| [`AxAIGoogleGeminiBatchEmbedResponse`](/api/#03-apidocs/typealiasaxaigooglegeminibatchembedresponse)
  \| [`AxAIGoogleVertexBatchEmbedResponse`](/api/#03-apidocs/typealiasaxaigooglevertexbatchembedresponse)\>

## Constructors

<a id="constructors"></a>

### new AxAIGoogleGemini()

```ts
new AxAIGoogleGemini(__namedParameters: Readonly<Omit<AxAIGoogleGeminiArgs, "name">>): AxAIGoogleGemini
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/google-gemini/api.ts#L583

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `__namedParameters` | `Readonly`\<`Omit`\<[`AxAIGoogleGeminiArgs`](/api/#03-apidocs/interfaceaxaigooglegeminiargs), `"name"`\>\> |

#### Returns

[`AxAIGoogleGemini`](/api/#03-apidocs/classaxaigooglegemini)

#### Overrides

[`AxBaseAI`](/api/#03-apidocs/classaxbaseai).[`constructor`](/api/#03-apidocs/classaxbaseaimdconstructors)

## Methods

<a id="chat"></a>

### chat()

```ts
chat(req: Readonly<AxChatRequest<AxAIGoogleGeminiModel>>, options?: Readonly<AxAIPromptConfig & AxAIServiceActionOptions<AxAIGoogleGeminiModel, AxAIGoogleGeminiEmbedModel>>): Promise<
  | AxChatResponse
| ReadableStream<AxChatResponse>>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L326

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `req` | `Readonly`\<[`AxChatRequest`](/api/#03-apidocs/typealiasaxchatrequest)\<[`AxAIGoogleGeminiModel`](/api/#03-apidocs/enumerationaxaigooglegeminimodel)\>\> |
| `options`? | `Readonly`\<[`AxAIPromptConfig`](/api/#03-apidocs/typealiasaxaipromptconfig) & [`AxAIServiceActionOptions`](/api/#03-apidocs/typealiasaxaiserviceactionoptions)\<[`AxAIGoogleGeminiModel`](/api/#03-apidocs/enumerationaxaigooglegeminimodel), [`AxAIGoogleGeminiEmbedModel`](/api/#03-apidocs/enumerationaxaigooglegeminiembedmodel)\>\> |

#### Returns

`Promise`\<
  \| [`AxChatResponse`](/api/#03-apidocs/typealiasaxchatresponse)
  \| `ReadableStream`\<[`AxChatResponse`](/api/#03-apidocs/typealiasaxchatresponse)\>\>

#### Inherited from

[`AxBaseAI`](/api/#03-apidocs/classaxbaseai).[`chat`](/api/#03-apidocs/classaxbaseaimdchat)

***

<a id="embed"></a>

### embed()

```ts
embed(req: Readonly<AxEmbedRequest<AxAIGoogleGeminiEmbedModel>>, options?: Readonly<AxAIServiceActionOptions<AxAIGoogleGeminiModel, AxAIGoogleGeminiEmbedModel>>): Promise<AxEmbedResponse>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L614

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `req` | `Readonly`\<[`AxEmbedRequest`](/api/#03-apidocs/typealiasaxembedrequest)\<[`AxAIGoogleGeminiEmbedModel`](/api/#03-apidocs/enumerationaxaigooglegeminiembedmodel)\>\> |
| `options`? | `Readonly`\<[`AxAIServiceActionOptions`](/api/#03-apidocs/typealiasaxaiserviceactionoptions)\<[`AxAIGoogleGeminiModel`](/api/#03-apidocs/enumerationaxaigooglegeminimodel), [`AxAIGoogleGeminiEmbedModel`](/api/#03-apidocs/enumerationaxaigooglegeminiembedmodel)\>\> |

#### Returns

`Promise`\<[`AxEmbedResponse`](/api/#03-apidocs/typealiasaxembedresponse)\>

#### Inherited from

[`AxBaseAI`](/api/#03-apidocs/classaxbaseai).[`embed`](/api/#03-apidocs/classaxbaseaimdembed)

***

<a id="getFeatures"></a>

### getFeatures()

```ts
getFeatures(model?: AxAIGoogleGeminiModel): AxAIFeatures
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L265

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `model`? | [`AxAIGoogleGeminiModel`](/api/#03-apidocs/enumerationaxaigooglegeminimodel) |

#### Returns

[`AxAIFeatures`](/api/#03-apidocs/interfaceaxaifeatures)

#### Inherited from

[`AxBaseAI`](/api/#03-apidocs/classaxbaseai).[`getFeatures`](/api/#03-apidocs/classaxbaseaimdgetfeatures)

***

<a id="getId"></a>

### getId()

```ts
getId(): string
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L194

#### Returns

`string`

#### Inherited from

[`AxBaseAI`](/api/#03-apidocs/classaxbaseai).[`getId`](/api/#03-apidocs/classaxbaseaimdgetid)

***

<a id="getLastUsedChatModel"></a>

### getLastUsedChatModel()

```ts
getLastUsedChatModel(): 
  | undefined
  | AxAIGoogleGeminiModel
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L271

#### Returns

  \| `undefined`
  \| [`AxAIGoogleGeminiModel`](/api/#03-apidocs/enumerationaxaigooglegeminimodel)

#### Inherited from

[`AxBaseAI`](/api/#03-apidocs/classaxbaseai).[`getLastUsedChatModel`](/api/#03-apidocs/classaxbaseaimdgetlastusedchatmodel)

***

<a id="getLastUsedEmbedModel"></a>

### getLastUsedEmbedModel()

```ts
getLastUsedEmbedModel(): 
  | undefined
  | AxAIGoogleGeminiEmbedModel
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L275

#### Returns

  \| `undefined`
  \| [`AxAIGoogleGeminiEmbedModel`](/api/#03-apidocs/enumerationaxaigooglegeminiembedmodel)

#### Inherited from

[`AxBaseAI`](/api/#03-apidocs/classaxbaseai).[`getLastUsedEmbedModel`](/api/#03-apidocs/classaxbaseaimdgetlastusedembedmodel)

***

<a id="getLastUsedModelConfig"></a>

### getLastUsedModelConfig()

```ts
getLastUsedModelConfig(): undefined | AxModelConfig
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L279

#### Returns

`undefined` \| [`AxModelConfig`](/api/#03-apidocs/typealiasaxmodelconfig)

#### Inherited from

[`AxBaseAI`](/api/#03-apidocs/classaxbaseai).[`getLastUsedModelConfig`](/api/#03-apidocs/classaxbaseaimdgetlastusedmodelconfig)

***

<a id="getLogger"></a>

### getLogger()

```ts
getLogger(): AxLoggerFunction
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L230

#### Returns

[`AxLoggerFunction`](/api/#03-apidocs/typealiasaxloggerfunction)

#### Inherited from

[`AxBaseAI`](/api/#03-apidocs/classaxbaseai).[`getLogger`](/api/#03-apidocs/classaxbaseaimdgetlogger)

***

<a id="getMetrics"></a>

### getMetrics()

```ts
getMetrics(): AxAIServiceMetrics
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L322

#### Returns

[`AxAIServiceMetrics`](/api/#03-apidocs/interfaceaxaiservicemetrics)

#### Inherited from

[`AxBaseAI`](/api/#03-apidocs/classaxbaseai).[`getMetrics`](/api/#03-apidocs/classaxbaseaimdgetmetrics)

***

<a id="getModelList"></a>

### getModelList()

```ts
getModelList(): undefined | AxAIModelList
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L234

#### Returns

`undefined` \| [`AxAIModelList`](/api/#03-apidocs/typealiasaxaimodellist)

#### Inherited from

[`AxBaseAI`](/api/#03-apidocs/classaxbaseai).[`getModelList`](/api/#03-apidocs/classaxbaseaimdgetmodellist)

***

<a id="getName"></a>

### getName()

```ts
getName(): string
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L261

#### Returns

`string`

#### Inherited from

[`AxBaseAI`](/api/#03-apidocs/classaxbaseai).[`getName`](/api/#03-apidocs/classaxbaseaimdgetname)

***

<a id="getOptions"></a>

### getOptions()

```ts
getOptions(): Readonly<AxAIServiceOptions>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L217

#### Returns

`Readonly`\<[`AxAIServiceOptions`](/api/#03-apidocs/typealiasaxaiserviceoptions)\>

#### Inherited from

[`AxBaseAI`](/api/#03-apidocs/classaxbaseai).[`getOptions`](/api/#03-apidocs/classaxbaseaimdgetoptions)

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

#### Inherited from

[`AxBaseAI`](/api/#03-apidocs/classaxbaseai).[`setAPIURL`](/api/#03-apidocs/classaxbaseaimdsetapiurl)

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

#### Inherited from

[`AxBaseAI`](/api/#03-apidocs/classaxbaseai).[`setHeaders`](/api/#03-apidocs/classaxbaseaimdsetheaders)

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

#### Inherited from

[`AxBaseAI`](/api/#03-apidocs/classaxbaseai).[`setName`](/api/#03-apidocs/classaxbaseaimdsetname)

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

#### Inherited from

[`AxBaseAI`](/api/#03-apidocs/classaxbaseai).[`setOptions`](/api/#03-apidocs/classaxbaseaimdsetoptions)
