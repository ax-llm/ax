---
title: AxAIServiceImpl
---

Defined in: [src/ax/ai/types.ts:244](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaitypestsl244)

## Type Parameters

| Type Parameter |
| ------ |
| `TChatRequest` |
| `TEmbedRequest` |
| `TChatResponse` |
| `TChatResponseDelta` |
| `TEmbedResponse` |

## Methods

<a id="createChatReq"></a>

### createChatReq()

> **createChatReq**(`req`, `config`): \[[`AxAPI`](#apidocs/typealiasaxapi), `TChatRequest`\]

Defined in: [src/ax/ai/types.ts:251](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaitypestsl251)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxInternalChatRequest`](#apidocs/typealiasaxinternalchatrequest)\> |
| `config` | `Readonly`\<[`AxAIPromptConfig`](#apidocs/typealiasaxaipromptconfig)\> |

#### Returns

\[[`AxAPI`](#apidocs/typealiasaxapi), `TChatRequest`\]

***

<a id="createChatResp"></a>

### createChatResp()

> **createChatResp**(`resp`): [`AxChatResponse`](#apidocs/typealiasaxchatresponse)

Defined in: [src/ax/ai/types.ts:256](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaitypestsl256)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `resp` | `Readonly`\<`TChatResponse`\> |

#### Returns

[`AxChatResponse`](#apidocs/typealiasaxchatresponse)

***

<a id="createChatStreamResp"></a>

### createChatStreamResp()?

> `optional` **createChatStreamResp**(`resp`, `state`): [`AxChatResponse`](#apidocs/typealiasaxchatresponse)

Defined in: [src/ax/ai/types.ts:258](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaitypestsl258)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `resp` | `Readonly`\<`TChatResponseDelta`\> |
| `state` | `object` |

#### Returns

[`AxChatResponse`](#apidocs/typealiasaxchatresponse)

***

<a id="createEmbedReq"></a>

### createEmbedReq()?

> `optional` **createEmbedReq**(`req`): \[[`AxAPI`](#apidocs/typealiasaxapi), `TEmbedRequest`\]

Defined in: [src/ax/ai/types.ts:263](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaitypestsl263)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Readonly`\<[`AxInternalEmbedRequest`](#apidocs/typealiasaxinternalembedrequest)\> |

#### Returns

\[[`AxAPI`](#apidocs/typealiasaxapi), `TEmbedRequest`\]

***

<a id="createEmbedResp"></a>

### createEmbedResp()?

> `optional` **createEmbedResp**(`resp`): [`AxEmbedResponse`](#apidocs/typealiasaxembedresponse)

Defined in: [src/ax/ai/types.ts:265](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaitypestsl265)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `resp` | `Readonly`\<`TEmbedResponse`\> |

#### Returns

[`AxEmbedResponse`](#apidocs/typealiasaxembedresponse)

***

<a id="getModelConfig"></a>

### getModelConfig()

> **getModelConfig**(): [`AxModelConfig`](#apidocs/typealiasaxmodelconfig)

Defined in: [src/ax/ai/types.ts:267](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaitypestsl267)

#### Returns

[`AxModelConfig`](#apidocs/typealiasaxmodelconfig)
