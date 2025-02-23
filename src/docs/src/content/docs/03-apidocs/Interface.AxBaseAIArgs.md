---
title: AxBaseAIArgs
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L34

## Type Parameters

| Type Parameter |
| ------ |
| `TModel` |
| `TEmbedModel` |

## Properties

<a id="apiURL"></a>

### apiURL

> **apiURL**: `string`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L36

***

<a id="defaults"></a>

### defaults

> **defaults**: `Readonly`\<\{ `embedModel`: `TEmbedModel`; `model`: `TModel`; \}\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L39

***

<a id="headers"></a>

### headers()

> **headers**: () => `Promise`\<`Record`\<`string`, `string`\>\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L37

#### Returns

`Promise`\<`Record`\<`string`, `string`\>\>

***

<a id="modelInfo"></a>

### modelInfo

> **modelInfo**: readonly [`AxModelInfo`](/api/#03-apidocs/typealiasaxmodelinfo)[]

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L38

***

<a id="models"></a>

### models?

> `optional` **models**: `AxAIInputModelList`\<`TModel`\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L42

***

<a id="name"></a>

### name

> **name**: `string`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L35

***

<a id="options"></a>

### options?

> `optional` **options**: `Readonly`\<[`AxAIServiceOptions`](/api/#03-apidocs/typealiasaxaiserviceoptions)\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L40

***

<a id="supportFor"></a>

### supportFor

> **supportFor**: [`AxAIFeatures`](/api/#03-apidocs/interfaceaxaifeatures) \| (`model`) => [`AxAIFeatures`](/api/#03-apidocs/interfaceaxaifeatures)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/base.ts#L41
