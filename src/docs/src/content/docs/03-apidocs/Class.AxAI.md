---
title: AxAI
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/wrap.ts#L86

## Implements

- [`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)

## Constructors

<a id="constructors"></a>

### new AxAI()

```ts
new AxAI(options: Readonly<AxAIArgs>): AxAI
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/wrap.ts#L89

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `options` | `Readonly`\<[`AxAIArgs`](/api/#03-apidocs/typealiasaxaiargs)\> |

#### Returns

[`AxAI`](/api/#03-apidocs/classaxai)

## Methods

<a id="chat"></a>

### chat()

```ts
chat(req: Readonly<AxChatRequest>, options?: Readonly<AxAIPromptConfig & AxAIServiceActionOptions>): Promise<
  | AxChatResponse
| ReadableStream<AxChatResponse>>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/wrap.ts#L167

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `req` | `Readonly`\<[`AxChatRequest`](/api/#03-apidocs/typealiasaxchatrequest)\> |
| `options`? | `Readonly`\<[`AxAIPromptConfig`](/api/#03-apidocs/typealiasaxaipromptconfig) & [`AxAIServiceActionOptions`](/api/#03-apidocs/typealiasaxaiserviceactionoptions)\> |

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
embed(req: Readonly<AxEmbedRequest>, options?: Readonly<AxAIServiceActionOptions>): Promise<AxEmbedResponse>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/wrap.ts#L174

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `req` | `Readonly`\<[`AxEmbedRequest`](/api/#03-apidocs/typealiasaxembedrequest)\> |
| `options`? | `Readonly`\<[`AxAIServiceActionOptions`](/api/#03-apidocs/typealiasaxaiserviceactionoptions)\> |

#### Returns

`Promise`\<[`AxEmbedResponse`](/api/#03-apidocs/typealiasaxembedresponse)\>

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`embed`](/api/#03-apidocs/interfaceaxaiservicemdembed)

***

<a id="getFeatures"></a>

### getFeatures()

```ts
getFeatures(model?: string): object
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/wrap.ts#L143

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `model`? | `string` |

#### Returns

`object`

| Name | Type |
| :------ | :------ |
| <a id="functions"></a> `functions` | `boolean` |
| <a id="streaming"></a> `streaming` | `boolean` |

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`getFeatures`](/api/#03-apidocs/interfaceaxaiservicemdgetfeatures)

***

<a id="getId"></a>

### getId()

```ts
getId(): string
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/wrap.ts#L139

#### Returns

`string`

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`getId`](/api/#03-apidocs/interfaceaxaiservicemdgetid)

***

<a id="getLastUsedChatModel"></a>

### getLastUsedChatModel()

```ts
getLastUsedChatModel(): unknown
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/wrap.ts#L151

#### Returns

`unknown`

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`getLastUsedChatModel`](/api/#03-apidocs/interfaceaxaiservicemdgetlastusedchatmodel)

***

<a id="getLastUsedEmbedModel"></a>

### getLastUsedEmbedModel()

```ts
getLastUsedEmbedModel(): unknown
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/wrap.ts#L155

#### Returns

`unknown`

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`getLastUsedEmbedModel`](/api/#03-apidocs/interfaceaxaiservicemdgetlastusedembedmodel)

***

<a id="getLastUsedModelConfig"></a>

### getLastUsedModelConfig()

```ts
getLastUsedModelConfig(): undefined | AxModelConfig
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/wrap.ts#L159

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

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/wrap.ts#L189

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

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/wrap.ts#L163

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

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/wrap.ts#L147

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

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/wrap.ts#L135

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

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/wrap.ts#L185

#### Returns

`Readonly`\<[`AxAIServiceOptions`](/api/#03-apidocs/typealiasaxaiserviceoptions)\>

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`getOptions`](/api/#03-apidocs/interfaceaxaiservicemdgetoptions)

***

<a id="setOptions"></a>

### setOptions()

```ts
setOptions(options: Readonly<AxAIServiceOptions>): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/wrap.ts#L181

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `options` | `Readonly`\<[`AxAIServiceOptions`](/api/#03-apidocs/typealiasaxaiserviceoptions)\> |

#### Returns

`void`

#### Implementation of

[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice).[`setOptions`](/api/#03-apidocs/interfaceaxaiservicemdsetoptions)
