---
title: AxAIServiceImpl
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/types.ts#L268

## Type Parameters

| Type Parameter |
| ------ |
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

> **createChatReq**(`req`, `config`): \[[`AxAPI`](/api/#03-apidocs/interfaceaxapi), `TChatRequest`\]

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/types.ts#L277

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxInternalChatRequest`](/api/#03-apidocs/typealiasaxinternalchatrequest)\<`TModel`\>\> |
| `config` | `Readonly`\<[`AxAIPromptConfig`](/api/#03-apidocs/typealiasaxaipromptconfig)\> |

#### Returns

\[[`AxAPI`](/api/#03-apidocs/interfaceaxapi), `TChatRequest`\]

***

<a id="createChatResp"></a>

### createChatResp()

> **createChatResp**(`resp`): [`AxChatResponse`](/api/#03-apidocs/typealiasaxchatresponse)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/types.ts#L282

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `resp` | `Readonly`\<`TChatResponse`\> |

#### Returns

[`AxChatResponse`](/api/#03-apidocs/typealiasaxchatresponse)

***

<a id="createChatStreamResp"></a>

### createChatStreamResp()?

> `optional` **createChatStreamResp**(`resp`, `state`): [`AxChatResponse`](/api/#03-apidocs/typealiasaxchatresponse)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/types.ts#L284

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `resp` | `Readonly`\<`TChatResponseDelta`\> |
| `state` | `object` |

#### Returns

[`AxChatResponse`](/api/#03-apidocs/typealiasaxchatresponse)

***

<a id="createEmbedReq"></a>

### createEmbedReq()?

> `optional` **createEmbedReq**(`req`): \[[`AxAPI`](/api/#03-apidocs/interfaceaxapi), `TEmbedRequest`\]

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/types.ts#L289

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxInternalEmbedRequest`](/api/#03-apidocs/typealiasaxinternalembedrequest)\<`TEmbedModel`\>\> |

#### Returns

\[[`AxAPI`](/api/#03-apidocs/interfaceaxapi), `TEmbedRequest`\]

***

<a id="createEmbedResp"></a>

### createEmbedResp()?

> `optional` **createEmbedResp**(`resp`): [`AxEmbedResponse`](/api/#03-apidocs/typealiasaxembedresponse)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/types.ts#L293

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `resp` | `Readonly`\<`TEmbedResponse`\> |

#### Returns

[`AxEmbedResponse`](/api/#03-apidocs/typealiasaxembedresponse)

***

<a id="getModelConfig"></a>

### getModelConfig()

> **getModelConfig**(): [`AxModelConfig`](/api/#03-apidocs/typealiasaxmodelconfig)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/types.ts#L295

#### Returns

[`AxModelConfig`](/api/#03-apidocs/typealiasaxmodelconfig)
