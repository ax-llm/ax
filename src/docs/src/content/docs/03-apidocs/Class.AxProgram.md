---
title: AxProgram
---

Defined in: [src/ax/dsp/program.ts:236](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl236)

## Type Parameters

| Type Parameter |
| ------ |
| `IN` *extends* [`AxGenIn`](#apidocs/typealiasaxgenin) |
| `OUT` *extends* [`AxGenOut`](#apidocs/typealiasaxgenout) |

## Implements

- [`AxTunable`](#apidocs/interfaceaxtunable)
- [`AxUsable`](#apidocs/interfaceaxusable)

## Constructors

<a id="Constructors"></a>

### new AxProgram()

> **new AxProgram**\<`IN`, `OUT`\>(): [`AxProgram`](#apidocs/classaxprogram)\<`IN`, `OUT`\>

Defined in: [src/ax/dsp/program.ts:245](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl245)

#### Returns

[`AxProgram`](#apidocs/classaxprogram)\<`IN`, `OUT`\>

## Methods

<a id="forward"></a>

### forward()

> **forward**(`_ai`, `_values`, `_options`?): `Promise`\<`OUT`\>

Defined in: [src/ax/dsp/program.ts:257](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl257)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `_ai` | `Readonly`\<[`AxAIService`](#apidocs/interfaceaxaiservice)\> |
| `_values` | `IN` |
| `_options`? | `Readonly`\<[`AxProgramForwardOptions`](#apidocs/typealiasaxprogramforwardoptions)\> |

#### Returns

`Promise`\<`OUT`\>

***

<a id="getTraces"></a>

### getTraces()

> **getTraces**(): [`AxProgramTrace`](#apidocs/typealiasaxprogramtrace)[]

Defined in: [src/ax/dsp/program.ts:291](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl291)

#### Returns

[`AxProgramTrace`](#apidocs/typealiasaxprogramtrace)[]

#### Implementation of

[`AxTunable`](#apidocs/interfaceaxtunable).[`getTraces`](#apidocs/interfaceaxtunablemdgettraces)

***

<a id="getUsage"></a>

### getUsage()

> **getUsage**(): [`AxTokenUsage`](#apidocs/typealiasaxtokenusage) & `object`[]

Defined in: [src/ax/dsp/program.ts:305](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl305)

#### Returns

[`AxTokenUsage`](#apidocs/typealiasaxtokenusage) & `object`[]

#### Implementation of

[`AxUsable`](#apidocs/interfaceaxusable).[`getUsage`](#apidocs/interfaceaxusablemdgetusage)

***

<a id="register"></a>

### register()

> **register**(`prog`): `void`

Defined in: [src/ax/dsp/program.ts:250](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl250)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `prog` | `Readonly`\<[`AxTunable`](#apidocs/interfaceaxtunable) & [`AxUsable`](#apidocs/interfaceaxusable)\> |

#### Returns

`void`

***

<a id="resetUsage"></a>

### resetUsage()

> **resetUsage**(): `void`

Defined in: [src/ax/dsp/program.ts:315](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl315)

#### Returns

`void`

#### Implementation of

[`AxUsable`](#apidocs/interfaceaxusable).[`resetUsage`](#apidocs/interfaceaxusablemdresetusage)

***

<a id="setDemos"></a>

### setDemos()

> **setDemos**(`demos`): `void`

Defined in: [src/ax/dsp/program.ts:322](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl322)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `demos` | readonly [`AxProgramDemos`](#apidocs/typealiasaxprogramdemos)[] |

#### Returns

`void`

#### Implementation of

[`AxTunable`](#apidocs/interfaceaxtunable).[`setDemos`](#apidocs/interfaceaxtunablemdsetdemos)

***

<a id="setExamples"></a>

### setExamples()

> **setExamples**(`examples`): `void`

Defined in: [src/ax/dsp/program.ts:281](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl281)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `examples` | `Readonly`\<[`AxProgramExamples`](#apidocs/typealiasaxprogramexamples)\> |

#### Returns

`void`

#### Implementation of

[`AxTunable`](#apidocs/interfaceaxtunable).[`setExamples`](#apidocs/interfaceaxtunablemdsetexamples)

***

<a id="setId"></a>

### setId()

> **setId**(`id`): `void`

Defined in: [src/ax/dsp/program.ts:268](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl268)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

`void`

#### Implementation of

[`AxTunable`](#apidocs/interfaceaxtunable).[`setId`](#apidocs/interfaceaxtunablemdsetid)

***

<a id="setParentId"></a>

### setParentId()

> **setParentId**(`parentId`): `void`

Defined in: [src/ax/dsp/program.ts:275](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl275)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `parentId` | `string` |

#### Returns

`void`

#### Implementation of

[`AxTunable`](#apidocs/interfaceaxtunable).[`setParentId`](#apidocs/interfaceaxtunablemdsetparentid)
