---
title: AxAIServiceImpl
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/types.ts#L329

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

## Methods

<a id="createChatReq"></a>

### createChatReq()

```ts
createChatReq(req: Readonly<AxInternalChatRequest<TModel>>, config: Readonly<AxAIPromptConfig>): [AxAPI, TChatRequest]
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/types.ts#L338

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `req` | `Readonly`\<[`AxInternalChatRequest`](/api/#03-apidocs/typealiasaxinternalchatrequest)\<`TModel`\>\> |
| `config` | `Readonly`\<[`AxAIPromptConfig`](/api/#03-apidocs/typealiasaxaipromptconfig)\> |

#### Returns

\[[`AxAPI`](/api/#03-apidocs/interfaceaxapi), `TChatRequest`\]

***

<a id="createChatResp"></a>

### createChatResp()

```ts
createChatResp(resp: Readonly<TChatResponse>): AxChatResponse
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/types.ts#L343

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `resp` | `Readonly`\<`TChatResponse`\> |

#### Returns

[`AxChatResponse`](/api/#03-apidocs/typealiasaxchatresponse)

***

<a id="createChatStreamResp"></a>

### createChatStreamResp()?

```ts
optional createChatStreamResp(resp: Readonly<TChatResponseDelta>, state: object): AxChatResponse
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/types.ts#L345

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `resp` | `Readonly`\<`TChatResponseDelta`\> |
| `state` | `object` |

#### Returns

[`AxChatResponse`](/api/#03-apidocs/typealiasaxchatresponse)

***

<a id="createEmbedReq"></a>

### createEmbedReq()?

```ts
optional createEmbedReq(req: Readonly<AxInternalEmbedRequest<TEmbedModel>>): [AxAPI, TEmbedRequest]
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/types.ts#L350

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `req` | `Readonly`\<[`AxInternalEmbedRequest`](/api/#03-apidocs/typealiasaxinternalembedrequest)\<`TEmbedModel`\>\> |

#### Returns

\[[`AxAPI`](/api/#03-apidocs/interfaceaxapi), `TEmbedRequest`\]

***

<a id="createEmbedResp"></a>

### createEmbedResp()?

```ts
optional createEmbedResp(resp: Readonly<TEmbedResponse>): AxEmbedResponse
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/types.ts#L354

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `resp` | `Readonly`\<`TEmbedResponse`\> |

#### Returns

[`AxEmbedResponse`](/api/#03-apidocs/typealiasaxembedresponse)

***

<a id="getModelConfig"></a>

### getModelConfig()

```ts
getModelConfig(): AxModelConfig
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/types.ts#L356

#### Returns

[`AxModelConfig`](/api/#03-apidocs/typealiasaxmodelconfig)

***

<a id="getTokenUsage"></a>

### getTokenUsage()

```ts
getTokenUsage(): undefined | AxTokenUsage
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/types.ts#L358

#### Returns

`undefined` \| [`AxTokenUsage`](/api/#03-apidocs/typealiasaxtokenusage)
