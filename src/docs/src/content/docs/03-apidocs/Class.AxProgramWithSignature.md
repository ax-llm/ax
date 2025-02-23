---
title: AxProgramWithSignature
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L105

## Extended by

- [`AxGen`](/api/#03-apidocs/classaxgen)

## Type Parameters

| Type Parameter |
| ------ |
| `IN` *extends* [`AxGenIn`](/api/#03-apidocs/typealiasaxgenin) |
| `OUT` *extends* [`AxGenOut`](/api/#03-apidocs/typealiasaxgenout) |

## Implements

- [`AxTunable`](/api/#03-apidocs/interfaceaxtunable)
- [`AxUsable`](/api/#03-apidocs/interfaceaxusable)

## Constructors

<a id="constructors"></a>

### new AxProgramWithSignature()

> **new AxProgramWithSignature**\<`IN`, `OUT`\>(`signature`, `options`?): [`AxProgramWithSignature`](/api/#03-apidocs/classaxprogramwithsignature)\<`IN`, `OUT`\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L119

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `signature` | `Readonly`\<`string` \| [`AxSignature`](/api/#03-apidocs/classaxsignature)\> |
| `options`? | `Readonly`\<[`AxProgramWithSignatureOptions`](/api/#03-apidocs/interfaceaxprogramwithsignatureoptions)\> |

#### Returns

[`AxProgramWithSignature`](/api/#03-apidocs/classaxprogramwithsignature)\<`IN`, `OUT`\>

## Methods

<a id="forward"></a>

### forward()

> **forward**(`_ai`, `_values`, `_options`?): `Promise`\<`OUT`\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L144

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `_ai` | `Readonly`\<[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)\<`unknown`, `unknown`\>\> |
| `_values` | `IN` |
| `_options`? | `Readonly`\<[`AxProgramForwardOptions`](/api/#03-apidocs/typealiasaxprogramforwardoptions)\> |

#### Returns

`Promise`\<`OUT`\>

***

<a id="getSignature"></a>

### getSignature()

> **getSignature**(): [`AxSignature`](/api/#03-apidocs/classaxsignature)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L133

#### Returns

[`AxSignature`](/api/#03-apidocs/classaxsignature)

***

<a id="getTraces"></a>

### getTraces()

> **getTraces**(): [`AxProgramTrace`](/api/#03-apidocs/typealiasaxprogramtrace)[]

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L220

#### Returns

[`AxProgramTrace`](/api/#03-apidocs/typealiasaxprogramtrace)[]

#### Implementation of

[`AxTunable`](/api/#03-apidocs/interfaceaxtunable).[`getTraces`](/api/#03-apidocs/interfaceaxtunablemdgettraces)

***

<a id="getUsage"></a>

### getUsage()

> **getUsage**(): [`AxTokenUsage`](/api/#03-apidocs/typealiasaxtokenusage) & `object`[]

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L234

#### Returns

[`AxTokenUsage`](/api/#03-apidocs/typealiasaxtokenusage) & `object`[]

#### Implementation of

[`AxUsable`](/api/#03-apidocs/interfaceaxusable).[`getUsage`](/api/#03-apidocs/interfaceaxusablemdgetusage)

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

***

<a id="resetUsage"></a>

### resetUsage()

> **resetUsage**(): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L244

#### Returns

`void`

#### Implementation of

[`AxUsable`](/api/#03-apidocs/interfaceaxusable).[`resetUsage`](/api/#03-apidocs/interfaceaxusablemdresetusage)

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

#### Implementation of

[`AxTunable`](/api/#03-apidocs/interfaceaxtunable).[`setDemos`](/api/#03-apidocs/interfaceaxtunablemdsetdemos)

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

#### Implementation of

[`AxTunable`](/api/#03-apidocs/interfaceaxtunable).[`setExamples`](/api/#03-apidocs/interfaceaxtunablemdsetexamples)

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

#### Implementation of

[`AxTunable`](/api/#03-apidocs/interfaceaxtunable).[`setId`](/api/#03-apidocs/interfaceaxtunablemdsetid)

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

#### Implementation of

[`AxTunable`](/api/#03-apidocs/interfaceaxtunable).[`setParentId`](/api/#03-apidocs/interfaceaxtunablemdsetparentid)

***

<a id="streamingForward"></a>

### streamingForward()

> **streamingForward**(`_ai`, `_values`, `_options`?): [`AxGenStreamingOut`](/api/#03-apidocs/typealiasaxgenstreamingout)\<`OUT`\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L155

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `_ai` | `Readonly`\<[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)\<`unknown`, `unknown`\>\> |
| `_values` | `IN` |
| `_options`? | `Readonly`\<[`AxProgramStreamingForwardOptions`](/api/#03-apidocs/typealiasaxprogramstreamingforwardoptions)\> |

#### Returns

[`AxGenStreamingOut`](/api/#03-apidocs/typealiasaxgenstreamingout)\<`OUT`\>
