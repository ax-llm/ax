---
title: AxProgramWithSignature
---

Defined in: [src/ax/dsp/program.ts:89](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl89)

## Extended by

- [`AxGen`](#apidocs/classaxgen)

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

### new AxProgramWithSignature()

> **new AxProgramWithSignature**\<`IN`, `OUT`\>(`signature`, `options`?): [`AxProgramWithSignature`](#apidocs/classaxprogramwithsignature)\<`IN`, `OUT`\>

Defined in: [src/ax/dsp/program.ts:103](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl103)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `signature` | `Readonly`\<`string` \| [`AxSignature`](#apidocs/classaxsignature)\> |
| `options`? | `Readonly`\<[`AxProgramWithSignatureOptions`](#apidocs/interfaceaxprogramwithsignatureoptions)\> |

#### Returns

[`AxProgramWithSignature`](#apidocs/classaxprogramwithsignature)\<`IN`, `OUT`\>

## Methods

<a id="forward"></a>

### forward()

> **forward**(`_ai`, `_values`, `_options`?): `Promise`\<`OUT`\>

Defined in: [src/ax/dsp/program.ts:128](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl128)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `_ai` | `Readonly`\<[`AxAIService`](#apidocs/interfaceaxaiservice)\> |
| `_values` | `IN` |
| `_options`? | `Readonly`\<[`AxProgramForwardOptions`](#apidocs/typealiasaxprogramforwardoptions)\> |

#### Returns

`Promise`\<`OUT`\>

***

<a id="getSignature"></a>

### getSignature()

> **getSignature**(): [`AxSignature`](#apidocs/classaxsignature)

Defined in: [src/ax/dsp/program.ts:117](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl117)

#### Returns

[`AxSignature`](#apidocs/classaxsignature)

***

<a id="getTraces"></a>

### getTraces()

> **getTraces**(): [`AxProgramTrace`](#apidocs/typealiasaxprogramtrace)[]

Defined in: [src/ax/dsp/program.ts:193](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl193)

#### Returns

[`AxProgramTrace`](#apidocs/typealiasaxprogramtrace)[]

#### Implementation of

[`AxTunable`](#apidocs/interfaceaxtunable).[`getTraces`](#apidocs/interfaceaxtunablemdgettraces)

***

<a id="getUsage"></a>

### getUsage()

> **getUsage**(): [`AxTokenUsage`](#apidocs/typealiasaxtokenusage) & `object`[]

Defined in: [src/ax/dsp/program.ts:207](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl207)

#### Returns

[`AxTokenUsage`](#apidocs/typealiasaxtokenusage) & `object`[]

#### Implementation of

[`AxUsable`](#apidocs/interfaceaxusable).[`getUsage`](#apidocs/interfaceaxusablemdgetusage)

***

<a id="register"></a>

### register()

> **register**(`prog`): `void`

Defined in: [src/ax/dsp/program.ts:121](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl121)

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

Defined in: [src/ax/dsp/program.ts:217](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl217)

#### Returns

`void`

#### Implementation of

[`AxUsable`](#apidocs/interfaceaxusable).[`resetUsage`](#apidocs/interfaceaxusablemdresetusage)

***

<a id="setDemos"></a>

### setDemos()

> **setDemos**(`demos`): `void`

Defined in: [src/ax/dsp/program.ts:224](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl224)

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

Defined in: [src/ax/dsp/program.ts:152](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl152)

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

Defined in: [src/ax/dsp/program.ts:139](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl139)

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

Defined in: [src/ax/dsp/program.ts:146](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl146)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `parentId` | `string` |

#### Returns

`void`

#### Implementation of

[`AxTunable`](#apidocs/interfaceaxtunable).[`setParentId`](#apidocs/interfaceaxtunablemdsetparentid)
