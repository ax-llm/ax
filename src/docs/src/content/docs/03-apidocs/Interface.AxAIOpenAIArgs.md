---
title: AxAIOpenAIArgs
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/openai/api.ts#L70

## Extends

- `Omit`\<[`AxAIOpenAIBaseArgs`](/api/#03-apidocs/interfaceaxaiopenaibaseargs)\<`TModel`, `TEmbedModel`\>, `"config"` \| `"modelInfo"`\>

## Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `TName` | `"openai"` |
| `TModel` | [`AxAIOpenAIModel`](/api/#03-apidocs/enumerationaxaiopenaimodel) |
| `TEmbedModel` | [`AxAIOpenAIEmbedModel`](/api/#03-apidocs/enumerationaxaiopenaiembedmodel) |

## Properties

<a id="apiKey"></a>

### apiKey

> **apiKey**: `string`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/openai/api.ts#L83

#### Inherited from

`Omit.apiKey`

***

<a id="apiURL"></a>

### apiURL?

> `optional` **apiURL**: `string`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/openai/api.ts#L84

#### Inherited from

`Omit.apiURL`

***

<a id="config"></a>

### config?

> `optional` **config**: `Partial`\<`Readonly`\<[`AxAIOpenAIConfig`](/api/#03-apidocs/typealiasaxaiopenaiconfig)\<`TModel`, `TEmbedModel`\>\>\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/openai/api.ts#L79

***

<a id="models"></a>

### models?

> `optional` **models**: `AxAIInputModelList`\<`TModel`\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/openai/api.ts#L88

#### Inherited from

`Omit.models`

***

<a id="name"></a>

### name

> **name**: `TName`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/openai/api.ts#L78

***

<a id="options"></a>

### options?

> `optional` **options**: `Readonly`\<[`AxAIServiceOptions`](/api/#03-apidocs/typealiasaxaiserviceoptions) & `object`\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/openai/api.ts#L86

#### Inherited from

`Omit.options`
