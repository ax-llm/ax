---
title: AxRAG
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/prompts/rag.ts#L12

## Extends

- [`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought)\<\{ `context`: `string`[]; `question`: `string`; \}, \{ `answer`: `string`; \}\>

## Constructors

<a id="constructors"></a>

### new AxRAG()

> **new AxRAG**(`queryFn`, `options`): [`AxRAG`](/api/#03-apidocs/classaxrag)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/prompts/rag.ts#L23

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `queryFn` | (`query`) => `Promise`\<`string`\> |
| `options` | `Readonly`\<[`AxGenOptions`](/api/#03-apidocs/interfaceaxgenoptions) & `object`\> |

#### Returns

[`AxRAG`](/api/#03-apidocs/classaxrag)

#### Overrides

[`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought).[`constructor`](/api/#03-apidocs/classaxchainofthoughtmdconstructors)

## Methods

<a id="_forward1"></a>

### \_forward1()

> **\_forward1**(`ai`, `values`, `options`): `AsyncGenerator`\<\{ `delta`: `Partial`\<`object` & `object`\>; `version`: `number`; \}, `void`, `unknown`\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/generate.ts#L603

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ai` | `Readonly`\<[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)\<`unknown`, `unknown`\>\> |
| `values` | \{ `context`: `string`[]; `question`: `string`; \} |
| `values.context` | `string`[] |
| `values.question` | `string` |
| `options` | `Readonly`\<[`AxProgramForwardOptions`](/api/#03-apidocs/typealiasaxprogramforwardoptions)\> |

#### Returns

`AsyncGenerator`\<\{ `delta`: `Partial`\<`object` & `object`\>; `version`: `number`; \}, `void`, `unknown`\>

#### Inherited from

[`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought).[`_forward1`](/api/#03-apidocs/classaxchainofthoughtmdforward1)

***

<a id="addAssert"></a>

### addAssert()

> **addAssert**(`fn`, `message`?): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/generate.ts#L133

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `fn` | (`values`) => `undefined` \| `boolean` |
| `message`? | `string` |

#### Returns

`void`

#### Inherited from

[`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought).[`addAssert`](/api/#03-apidocs/classaxchainofthoughtmdaddassert)

***

<a id="addFieldProcessor"></a>

### addFieldProcessor()

> **addFieldProcessor**(`fieldName`, `fn`): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/generate.ts#L180

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `fieldName` | `string` |
| `fn` | `AxFieldProcessorProcess` \| `AxStreamingFieldProcessorProcess` |

#### Returns

`void`

#### Inherited from

[`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought).[`addFieldProcessor`](/api/#03-apidocs/classaxchainofthoughtmdaddfieldprocessor)

***

<a id="addStreamingAssert"></a>

### addStreamingAssert()

> **addStreamingAssert**(`fieldName`, `fn`, `message`?): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/generate.ts#L137

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `fieldName` | `string` |
| `fn` | (`content`, `done`?) => `undefined` \| `boolean` |
| `message`? | `string` |

#### Returns

`void`

#### Inherited from

[`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought).[`addStreamingAssert`](/api/#03-apidocs/classaxchainofthoughtmdaddstreamingassert)

***

<a id="addStreamingFieldProcessor"></a>

### addStreamingFieldProcessor()

> **addStreamingFieldProcessor**(`fieldName`, `fn`): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/generate.ts#L173

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `fieldName` | `string` |
| `fn` | `AxFieldProcessorProcess` \| `AxStreamingFieldProcessorProcess` |

#### Returns

`void`

#### Inherited from

[`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought).[`addStreamingFieldProcessor`](/api/#03-apidocs/classaxchainofthoughtmdaddstreamingfieldprocessor)

***

<a id="forward"></a>

### forward()

> **forward**(`ai`, `__namedParameters`, `options`?): `Promise`\<\{ `answer`: `string`; `reason`: `string`; \}\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/prompts/rag.ts#L44

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ai` | `Readonly`\<[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)\<`unknown`, `unknown`\>\> |
| `__namedParameters` | `Readonly`\<\{ `question`: `string`; \}\> |
| `options`? | `Readonly`\<[`AxProgramForwardOptions`](/api/#03-apidocs/typealiasaxprogramforwardoptions)\> |

#### Returns

`Promise`\<\{ `answer`: `string`; `reason`: `string`; \}\>

#### Overrides

[`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought).[`forward`](/api/#03-apidocs/classaxchainofthoughtmdforward)

***

<a id="getSignature"></a>

### getSignature()

> **getSignature**(): [`AxSignature`](/api/#03-apidocs/classaxsignature)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L133

#### Returns

[`AxSignature`](/api/#03-apidocs/classaxsignature)

#### Inherited from

[`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought).[`getSignature`](/api/#03-apidocs/classaxchainofthoughtmdgetsignature)

***

<a id="getTraces"></a>

### getTraces()

> **getTraces**(): [`AxProgramTrace`](/api/#03-apidocs/typealiasaxprogramtrace)[]

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L220

#### Returns

[`AxProgramTrace`](/api/#03-apidocs/typealiasaxprogramtrace)[]

#### Inherited from

[`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought).[`getTraces`](/api/#03-apidocs/classaxchainofthoughtmdgettraces)

***

<a id="getUsage"></a>

### getUsage()

> **getUsage**(): [`AxTokenUsage`](/api/#03-apidocs/typealiasaxtokenusage) & `object`[]

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L234

#### Returns

[`AxTokenUsage`](/api/#03-apidocs/typealiasaxtokenusage) & `object`[]

#### Inherited from

[`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought).[`getUsage`](/api/#03-apidocs/classaxchainofthoughtmdgetusage)

***

<a id="register"></a>

### register()

> **register**(`prog`): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L137

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `prog` | `Readonly`\<[`AxTunable`](/api/#03-apidocs/interfaceaxtunable) & [`AxUsable`](/api/#03-apidocs/interfaceaxusable)\> |

#### Returns

`void`

#### Inherited from

[`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought).[`register`](/api/#03-apidocs/classaxchainofthoughtmdregister)

***

<a id="resetUsage"></a>

### resetUsage()

> **resetUsage**(): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L244

#### Returns

`void`

#### Inherited from

[`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought).[`resetUsage`](/api/#03-apidocs/classaxchainofthoughtmdresetusage)

***

<a id="setDemos"></a>

### setDemos()

> **setDemos**(`demos`): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L251

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `demos` | readonly [`AxProgramDemos`](/api/#03-apidocs/typealiasaxprogramdemos)[] |

#### Returns

`void`

#### Inherited from

[`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought).[`setDemos`](/api/#03-apidocs/classaxchainofthoughtmdsetdemos)

***

<a id="setExamples"></a>

### setExamples()

> **setExamples**(`examples`): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L179

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `examples` | `Readonly`\<[`AxProgramExamples`](/api/#03-apidocs/typealiasaxprogramexamples)\> |

#### Returns

`void`

#### Inherited from

[`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought).[`setExamples`](/api/#03-apidocs/classaxchainofthoughtmdsetexamples)

***

<a id="setId"></a>

### setId()

> **setId**(`id`): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L166

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

`void`

#### Inherited from

[`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought).[`setId`](/api/#03-apidocs/classaxchainofthoughtmdsetid)

***

<a id="setParentId"></a>

### setParentId()

> **setParentId**(`parentId`): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L173

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `parentId` | `string` |

#### Returns

`void`

#### Inherited from

[`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought).[`setParentId`](/api/#03-apidocs/classaxchainofthoughtmdsetparentid)

***

<a id="streamingForward"></a>

### streamingForward()

> **streamingForward**(`ai`, `values`, `options`?): `AsyncGenerator`\<\{ `delta`: `Partial`\<`object` & `object`\>; `version`: `number`; \}, `void`, `unknown`\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/generate.ts#L675

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ai` | `Readonly`\<[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)\<`unknown`, `unknown`\>\> |
| `values` | \{ `context`: `string`[]; `question`: `string`; \} |
| `values.context` | `string`[] |
| `values.question`? | `string` |
| `options`? | `Readonly`\<[`AxProgramStreamingForwardOptions`](/api/#03-apidocs/typealiasaxprogramstreamingforwardoptions)\> |

#### Returns

`AsyncGenerator`\<\{ `delta`: `Partial`\<`object` & `object`\>; `version`: `number`; \}, `void`, `unknown`\>

#### Inherited from

[`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought).[`streamingForward`](/api/#03-apidocs/classaxchainofthoughtmdstreamingforward)
