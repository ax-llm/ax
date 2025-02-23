---
title: AxGen
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/generate.ts#L100

## Extends

- [`AxProgramWithSignature`](/api/#03-apidocs/classaxprogramwithsignature)\<`IN`, `OUT`\>

## Extended by

- [`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought)
- [`AxDefaultQueryRewriter`](/api/#03-apidocs/classaxdefaultqueryrewriter)
- [`AxDefaultResultReranker`](/api/#03-apidocs/classaxdefaultresultreranker)

## Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `IN` *extends* [`AxGenIn`](/api/#03-apidocs/typealiasaxgenin) | [`AxGenIn`](/api/#03-apidocs/typealiasaxgenin) |
| `OUT` *extends* [`AxGenerateResult`](/api/#03-apidocs/typealiasaxgenerateresult)\<[`AxGenOut`](/api/#03-apidocs/typealiasaxgenout)\> | [`AxGenerateResult`](/api/#03-apidocs/typealiasaxgenerateresult)\<[`AxGenOut`](/api/#03-apidocs/typealiasaxgenout)\> |

## Constructors

<a id="constructors"></a>

### new AxGen()

> **new AxGen**\<`IN`, `OUT`\>(`signature`, `options`?): [`AxGen`](/api/#03-apidocs/classaxgen)\<`IN`, `OUT`\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/generate.ts#L113

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `signature` | `Readonly`\<`string` \| [`AxSignature`](/api/#03-apidocs/classaxsignature)\> |
| `options`? | `Readonly`\<[`AxGenOptions`](/api/#03-apidocs/interfaceaxgenoptions)\> |

#### Returns

[`AxGen`](/api/#03-apidocs/classaxgen)\<`IN`, `OUT`\>

#### Overrides

[`AxProgramWithSignature`](/api/#03-apidocs/classaxprogramwithsignature).[`constructor`](/api/#03-apidocs/classaxprogramwithsignaturemdconstructors)

## Methods

<a id="_forward1"></a>

### \_forward1()

> **\_forward1**(`ai`, `values`, `options`): `AsyncGenerator`\<\{ `delta`: `Partial`\<`OUT`\>; `version`: `number`; \}, `void`, `unknown`\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/generate.ts#L603

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ai` | `Readonly`\<[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)\<`unknown`, `unknown`\>\> |
| `values` | `IN` |
| `options` | `Readonly`\<[`AxProgramForwardOptions`](/api/#03-apidocs/typealiasaxprogramforwardoptions)\> |

#### Returns

`AsyncGenerator`\<\{ `delta`: `Partial`\<`OUT`\>; `version`: `number`; \}, `void`, `unknown`\>

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

***

<a id="forward"></a>

### forward()

> **forward**(`ai`, `values`, `options`?): `Promise`\<`OUT`\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/generate.ts#L651

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ai` | `Readonly`\<[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)\<`unknown`, `unknown`\>\> |
| `values` | `IN` |
| `options`? | `Readonly`\<[`AxProgramForwardOptions`](/api/#03-apidocs/typealiasaxprogramforwardoptions)\> |

#### Returns

`Promise`\<`OUT`\>

#### Overrides

[`AxProgramWithSignature`](/api/#03-apidocs/classaxprogramwithsignature).[`forward`](/api/#03-apidocs/classaxprogramwithsignaturemdforward)

***

<a id="getSignature"></a>

### getSignature()

> **getSignature**(): [`AxSignature`](/api/#03-apidocs/classaxsignature)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L133

#### Returns

[`AxSignature`](/api/#03-apidocs/classaxsignature)

#### Inherited from

[`AxProgramWithSignature`](/api/#03-apidocs/classaxprogramwithsignature).[`getSignature`](/api/#03-apidocs/classaxprogramwithsignaturemdgetsignature)

***

<a id="getTraces"></a>

### getTraces()

> **getTraces**(): [`AxProgramTrace`](/api/#03-apidocs/typealiasaxprogramtrace)[]

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L220

#### Returns

[`AxProgramTrace`](/api/#03-apidocs/typealiasaxprogramtrace)[]

#### Inherited from

[`AxProgramWithSignature`](/api/#03-apidocs/classaxprogramwithsignature).[`getTraces`](/api/#03-apidocs/classaxprogramwithsignaturemdgettraces)

***

<a id="getUsage"></a>

### getUsage()

> **getUsage**(): [`AxTokenUsage`](/api/#03-apidocs/typealiasaxtokenusage) & `object`[]

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L234

#### Returns

[`AxTokenUsage`](/api/#03-apidocs/typealiasaxtokenusage) & `object`[]

#### Inherited from

[`AxProgramWithSignature`](/api/#03-apidocs/classaxprogramwithsignature).[`getUsage`](/api/#03-apidocs/classaxprogramwithsignaturemdgetusage)

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

[`AxProgramWithSignature`](/api/#03-apidocs/classaxprogramwithsignature).[`register`](/api/#03-apidocs/classaxprogramwithsignaturemdregister)

***

<a id="resetUsage"></a>

### resetUsage()

> **resetUsage**(): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L244

#### Returns

`void`

#### Inherited from

[`AxProgramWithSignature`](/api/#03-apidocs/classaxprogramwithsignature).[`resetUsage`](/api/#03-apidocs/classaxprogramwithsignaturemdresetusage)

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

[`AxProgramWithSignature`](/api/#03-apidocs/classaxprogramwithsignature).[`setDemos`](/api/#03-apidocs/classaxprogramwithsignaturemdsetdemos)

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

[`AxProgramWithSignature`](/api/#03-apidocs/classaxprogramwithsignature).[`setExamples`](/api/#03-apidocs/classaxprogramwithsignaturemdsetexamples)

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

[`AxProgramWithSignature`](/api/#03-apidocs/classaxprogramwithsignature).[`setId`](/api/#03-apidocs/classaxprogramwithsignaturemdsetid)

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

[`AxProgramWithSignature`](/api/#03-apidocs/classaxprogramwithsignature).[`setParentId`](/api/#03-apidocs/classaxprogramwithsignaturemdsetparentid)

***

<a id="streamingForward"></a>

### streamingForward()

> **streamingForward**(`ai`, `values`, `options`?): `AsyncGenerator`\<\{ `delta`: `Partial`\<`OUT`\>; `version`: `number`; \}, `void`, `unknown`\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/generate.ts#L675

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ai` | `Readonly`\<[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)\<`unknown`, `unknown`\>\> |
| `values` | `IN` |
| `options`? | `Readonly`\<[`AxProgramStreamingForwardOptions`](/api/#03-apidocs/typealiasaxprogramstreamingforwardoptions)\> |

#### Returns

`AsyncGenerator`\<\{ `delta`: `Partial`\<`OUT`\>; `version`: `number`; \}, `void`, `unknown`\>

#### Overrides

[`AxProgramWithSignature`](/api/#03-apidocs/classaxprogramwithsignature).[`streamingForward`](/api/#03-apidocs/classaxprogramwithsignaturemdstreamingforward)
