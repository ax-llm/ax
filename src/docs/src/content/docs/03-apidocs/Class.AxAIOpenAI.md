---
title: AxAIOpenAI
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/openai/api.ts#L574

## Extends

- [`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase)\<[`AxAIOpenAIModel`](/api/#03-apidocs/enumerationaxaiopenaimodel), [`AxAIOpenAIEmbedModel`](/api/#03-apidocs/enumerationaxaiopenaiembedmodel)\>

## Constructors

<a id="constructors"></a>

### new AxAIOpenAI()

```ts
new AxAIOpenAI(__namedParameters: Readonly<Omit<AxAIOpenAIArgs<"openai", AxAIOpenAIModel, AxAIOpenAIEmbedModel, AxAIOpenAIChatRequest<AxAIOpenAIModel>>, "name">>): AxAIOpenAI
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/openai/api.ts#L578

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `__namedParameters` | `Readonly`\<`Omit`\<[`AxAIOpenAIArgs`](/api/#03-apidocs/interfaceaxaiopenaiargs)\<`"openai"`, [`AxAIOpenAIModel`](/api/#03-apidocs/enumerationaxaiopenaimodel), [`AxAIOpenAIEmbedModel`](/api/#03-apidocs/enumerationaxaiopenaiembedmodel), [`AxAIOpenAIChatRequest`](/api/#03-apidocs/typealiasaxaiopenaichatrequest)\<[`AxAIOpenAIModel`](/api/#03-apidocs/enumerationaxaiopenaimodel)\>\>, `"name"`\>\> |

#### Returns

[`AxAIOpenAI`](/api/#03-apidocs/classaxaiopenai)

#### Overrides

[`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase).[`constructor`](/api/#03-apidocs/classaxaiopenaibasemdconstructors)

## Methods

<a id="chat"></a>

### chat()

```ts
chat(req: Readonly<AxChatRequest<AxAIOpenAIModel>>, options?: Readonly<AxAIPromptConfig & AxAIServiceActionOptions<AxAIOpenAIModel, AxAIOpenAIEmbedModel>>): Promise<
  | AxChatResponse
| ReadableStream<AxChatResponse>>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L326

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `req` | `Readonly`\<[`AxChatRequest`](/api/#03-apidocs/typealiasaxchatrequest)\<[`AxAIOpenAIModel`](/api/#03-apidocs/enumerationaxaiopenaimodel)\>\> |
| `options`? | `Readonly`\<[`AxAIPromptConfig`](/api/#03-apidocs/typealiasaxaipromptconfig) & [`AxAIServiceActionOptions`](/api/#03-apidocs/typealiasaxaiserviceactionoptions)\<[`AxAIOpenAIModel`](/api/#03-apidocs/enumerationaxaiopenaimodel), [`AxAIOpenAIEmbedModel`](/api/#03-apidocs/enumerationaxaiopenaiembedmodel)\>\> |

#### Returns

`Promise`\<
  \| [`AxChatResponse`](/api/#03-apidocs/typealiasaxchatresponse)
  \| `ReadableStream`\<[`AxChatResponse`](/api/#03-apidocs/typealiasaxchatresponse)\>\>

#### Inherited from

[`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase).[`chat`](/api/#03-apidocs/classaxaiopenaibasemdchat)

***

<a id="embed"></a>

### embed()

```ts
embed(req: Readonly<AxEmbedRequest<AxAIOpenAIEmbedModel>>, options?: Readonly<AxAIServiceActionOptions<AxAIOpenAIModel, AxAIOpenAIEmbedModel>>): Promise<AxEmbedResponse>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L614

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `req` | `Readonly`\<[`AxEmbedRequest`](/api/#03-apidocs/typealiasaxembedrequest)\<[`AxAIOpenAIEmbedModel`](/api/#03-apidocs/enumerationaxaiopenaiembedmodel)\>\> |
| `options`? | `Readonly`\<[`AxAIServiceActionOptions`](/api/#03-apidocs/typealiasaxaiserviceactionoptions)\<[`AxAIOpenAIModel`](/api/#03-apidocs/enumerationaxaiopenaimodel), [`AxAIOpenAIEmbedModel`](/api/#03-apidocs/enumerationaxaiopenaiembedmodel)\>\> |

#### Returns

`Promise`\<[`AxEmbedResponse`](/api/#03-apidocs/typealiasaxembedresponse)\>

#### Inherited from

[`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase).[`embed`](/api/#03-apidocs/classaxaiopenaibasemdembed)

***

<a id="getFeatures"></a>

### getFeatures()

```ts
getFeatures(model?: AxAIOpenAIModel): AxAIFeatures
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L265

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `model`? | [`AxAIOpenAIModel`](/api/#03-apidocs/enumerationaxaiopenaimodel) |

#### Returns

[`AxAIFeatures`](/api/#03-apidocs/interfaceaxaifeatures)

#### Inherited from

[`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase).[`getFeatures`](/api/#03-apidocs/classaxaiopenaibasemdgetfeatures)

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

[`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase).[`getId`](/api/#03-apidocs/classaxaiopenaibasemdgetid)

***

<a id="getLastUsedChatModel"></a>

### getLastUsedChatModel()

```ts
getLastUsedChatModel(): undefined | AxAIOpenAIModel
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L271

#### Returns

`undefined` \| [`AxAIOpenAIModel`](/api/#03-apidocs/enumerationaxaiopenaimodel)

#### Inherited from

[`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase).[`getLastUsedChatModel`](/api/#03-apidocs/classaxaiopenaibasemdgetlastusedchatmodel)

***

<a id="getLastUsedEmbedModel"></a>

### getLastUsedEmbedModel()

```ts
getLastUsedEmbedModel(): 
  | undefined
  | AxAIOpenAIEmbedModel
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L275

#### Returns

  \| `undefined`
  \| [`AxAIOpenAIEmbedModel`](/api/#03-apidocs/enumerationaxaiopenaiembedmodel)

#### Inherited from

[`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase).[`getLastUsedEmbedModel`](/api/#03-apidocs/classaxaiopenaibasemdgetlastusedembedmodel)

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

[`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase).[`getLastUsedModelConfig`](/api/#03-apidocs/classaxaiopenaibasemdgetlastusedmodelconfig)

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

[`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase).[`getLogger`](/api/#03-apidocs/classaxaiopenaibasemdgetlogger)

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

[`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase).[`getMetrics`](/api/#03-apidocs/classaxaiopenaibasemdgetmetrics)

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

[`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase).[`getModelList`](/api/#03-apidocs/classaxaiopenaibasemdgetmodellist)

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

[`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase).[`getName`](/api/#03-apidocs/classaxaiopenaibasemdgetname)

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

[`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase).[`getOptions`](/api/#03-apidocs/classaxaiopenaibasemdgetoptions)

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

[`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase).[`setAPIURL`](/api/#03-apidocs/classaxaiopenaibasemdsetapiurl)

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

[`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase).[`setHeaders`](/api/#03-apidocs/classaxaiopenaibasemdsetheaders)

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

[`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase).[`setName`](/api/#03-apidocs/classaxaiopenaibasemdsetname)

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

[`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase).[`setOptions`](/api/#03-apidocs/classaxaiopenaibasemdsetoptions)
