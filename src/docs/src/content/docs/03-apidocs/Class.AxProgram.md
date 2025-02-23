---
title: AxProgram
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L263

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

### new AxProgram()

> **new AxProgram**\<`IN`, `OUT`\>(): [`AxProgram`](/api/#03-apidocs/classaxprogram)\<`IN`, `OUT`\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L272

#### Returns

[`AxProgram`](/api/#03-apidocs/classaxprogram)\<`IN`, `OUT`\>

## Methods

<a id="forward"></a>

### forward()

> **forward**(`_ai`, `_values`, `_options`?): `Promise`\<`OUT`\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L284

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `_ai` | `Readonly`\<[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)\<`unknown`, `unknown`\>\> |
| `_values` | `IN` |
| `_options`? | `Readonly`\<[`AxProgramForwardOptions`](/api/#03-apidocs/typealiasaxprogramforwardoptions)\> |

#### Returns

`Promise`\<`OUT`\>

***

<a id="getTraces"></a>

### getTraces()

> **getTraces**(): [`AxProgramTrace`](/api/#03-apidocs/typealiasaxprogramtrace)[]

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L329

#### Returns

[`AxProgramTrace`](/api/#03-apidocs/typealiasaxprogramtrace)[]

#### Implementation of

[`AxTunable`](/api/#03-apidocs/interfaceaxtunable).[`getTraces`](/api/#03-apidocs/interfaceaxtunablemdgettraces)

***

<a id="getUsage"></a>

### getUsage()

> **getUsage**(): [`AxTokenUsage`](/api/#03-apidocs/typealiasaxtokenusage) & `object`[]

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L343

#### Returns

[`AxTokenUsage`](/api/#03-apidocs/typealiasaxtokenusage) & `object`[]

#### Implementation of

[`AxUsable`](/api/#03-apidocs/interfaceaxusable).[`getUsage`](/api/#03-apidocs/interfaceaxusablemdgetusage)

***

<a id="register"></a>

### register()

> **register**(`prog`): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L277

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

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L353

#### Returns

`void`

#### Implementation of

[`AxUsable`](/api/#03-apidocs/interfaceaxusable).[`resetUsage`](/api/#03-apidocs/interfaceaxusablemdresetusage)

***

<a id="setDemos"></a>

### setDemos()

> **setDemos**(`demos`): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L360

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

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L319

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

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L306

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

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L313

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

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L295

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `_ai` | `Readonly`\<[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)\<`unknown`, `unknown`\>\> |
| `_values` | `IN` |
| `_options`? | `Readonly`\<[`AxProgramStreamingForwardOptions`](/api/#03-apidocs/typealiasaxprogramstreamingforwardoptions)\> |

#### Returns

[`AxGenStreamingOut`](/api/#03-apidocs/typealiasaxgenstreamingout)\<`OUT`\>
