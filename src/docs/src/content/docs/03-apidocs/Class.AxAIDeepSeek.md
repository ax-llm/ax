---
title: AxAIDeepSeek
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/deepseek/api.ts#L31

## Extends

- [`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase)\<[`AxAIDeepSeekModel`](/api/#03-apidocs/enumerationaxaideepseekmodel), `undefined`\>

## Constructors

<a id="constructors"></a>

### new AxAIDeepSeek()

```ts
new AxAIDeepSeek(__namedParameters: Readonly<Omit<AxAIDeepSeekArgs, "name">>): AxAIDeepSeek
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/deepseek/api.ts#L32

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `__namedParameters` | `Readonly`\<`Omit`\<[`AxAIDeepSeekArgs`](/api/#03-apidocs/typealiasaxaideepseekargs), `"name"`\>\> |

#### Returns

[`AxAIDeepSeek`](/api/#03-apidocs/classaxaideepseek)

#### Overrides

[`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase).[`constructor`](/api/#03-apidocs/classaxaiopenaibasemdconstructors)

## Methods

<a id="chat"></a>

### chat()

```ts
chat(req: Readonly<AxChatRequest<AxAIDeepSeekModel>>, options?: Readonly<AxAIPromptConfig & AxAIServiceActionOptions<AxAIDeepSeekModel, undefined>>): Promise<
  | AxChatResponse
| ReadableStream<AxChatResponse>>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L326

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `req` | `Readonly`\<[`AxChatRequest`](/api/#03-apidocs/typealiasaxchatrequest)\<[`AxAIDeepSeekModel`](/api/#03-apidocs/enumerationaxaideepseekmodel)\>\> |
| `options`? | `Readonly`\<[`AxAIPromptConfig`](/api/#03-apidocs/typealiasaxaipromptconfig) & [`AxAIServiceActionOptions`](/api/#03-apidocs/typealiasaxaiserviceactionoptions)\<[`AxAIDeepSeekModel`](/api/#03-apidocs/enumerationaxaideepseekmodel), `undefined`\>\> |

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
embed(req: Readonly<AxEmbedRequest<undefined>>, options?: Readonly<AxAIServiceActionOptions<AxAIDeepSeekModel, undefined>>): Promise<AxEmbedResponse>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L614

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `req` | `Readonly`\<[`AxEmbedRequest`](/api/#03-apidocs/typealiasaxembedrequest)\<`undefined`\>\> |
| `options`? | `Readonly`\<[`AxAIServiceActionOptions`](/api/#03-apidocs/typealiasaxaiserviceactionoptions)\<[`AxAIDeepSeekModel`](/api/#03-apidocs/enumerationaxaideepseekmodel), `undefined`\>\> |

#### Returns

`Promise`\<[`AxEmbedResponse`](/api/#03-apidocs/typealiasaxembedresponse)\>

#### Inherited from

[`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase).[`embed`](/api/#03-apidocs/classaxaiopenaibasemdembed)

***

<a id="getFeatures"></a>

### getFeatures()

```ts
getFeatures(model?: AxAIDeepSeekModel): AxAIFeatures
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L265

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `model`? | [`AxAIDeepSeekModel`](/api/#03-apidocs/enumerationaxaideepseekmodel) |

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
getLastUsedChatModel(): undefined | AxAIDeepSeekModel
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L271

#### Returns

`undefined` \| [`AxAIDeepSeekModel`](/api/#03-apidocs/enumerationaxaideepseekmodel)

#### Inherited from

[`AxAIOpenAIBase`](/api/#03-apidocs/classaxaiopenaibase).[`getLastUsedChatModel`](/api/#03-apidocs/classaxaiopenaibasemdgetlastusedchatmodel)

***

<a id="getLastUsedEmbedModel"></a>

### getLastUsedEmbedModel()

```ts
getLastUsedEmbedModel(): undefined
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/base.ts#L275

#### Returns

`undefined`

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
