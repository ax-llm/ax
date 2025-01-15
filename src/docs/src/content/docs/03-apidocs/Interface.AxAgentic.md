---
title: AxAgentic
---

Defined in: [src/ax/prompts/agent.ts:17](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxpromptsagenttsl17)

## Extends

- [`AxTunable`](#apidocs/interfaceaxtunable).[`AxUsable`](#apidocs/interfaceaxusable)

## Properties

<a id="getTraces"></a>

### getTraces()

> **getTraces**: () => [`AxProgramTrace`](#apidocs/typealiasaxprogramtrace)[]

Defined in: [src/ax/dsp/program.ts:71](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl71)

#### Returns

[`AxProgramTrace`](#apidocs/typealiasaxprogramtrace)[]

#### Inherited from

[`AxTunable`](#apidocs/interfaceaxtunable).[`getTraces`](#apidocs/interfaceaxtunablemdgettraces)

***

<a id="getUsage"></a>

### getUsage()

> **getUsage**: () => [`AxTokenUsage`](#apidocs/typealiasaxtokenusage) & `object`[]

Defined in: [src/ax/dsp/program.ts:76](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl76)

#### Returns

[`AxTokenUsage`](#apidocs/typealiasaxtokenusage) & `object`[]

#### Inherited from

[`AxUsable`](#apidocs/interfaceaxusable).[`getUsage`](#apidocs/interfaceaxusablemdgetusage)

***

<a id="resetUsage"></a>

### resetUsage()

> **resetUsage**: () => `void`

Defined in: [src/ax/dsp/program.ts:77](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl77)

#### Returns

`void`

#### Inherited from

[`AxUsable`](#apidocs/interfaceaxusable).[`resetUsage`](#apidocs/interfaceaxusablemdresetusage)

***

<a id="setDemos"></a>

### setDemos()

> **setDemos**: (`demos`) => `void`

Defined in: [src/ax/dsp/program.ts:72](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl72)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `demos` | readonly [`AxProgramDemos`](#apidocs/typealiasaxprogramdemos)[] |

#### Returns

`void`

#### Inherited from

[`AxTunable`](#apidocs/interfaceaxtunable).[`setDemos`](#apidocs/interfaceaxtunablemdsetdemos)

***

<a id="setExamples"></a>

### setExamples()

> **setExamples**: (`examples`) => `void`

Defined in: [src/ax/dsp/program.ts:68](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl68)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `examples` | `Readonly`\<[`AxProgramExamples`](#apidocs/typealiasaxprogramexamples)\> |

#### Returns

`void`

#### Inherited from

[`AxTunable`](#apidocs/interfaceaxtunable).[`setExamples`](#apidocs/interfaceaxtunablemdsetexamples)

***

<a id="setId"></a>

### setId()

> **setId**: (`id`) => `void`

Defined in: [src/ax/dsp/program.ts:69](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl69)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

`void`

#### Inherited from

[`AxTunable`](#apidocs/interfaceaxtunable).[`setId`](#apidocs/interfaceaxtunablemdsetid)

***

<a id="setParentId"></a>

### setParentId()

> **setParentId**: (`parentId`) => `void`

Defined in: [src/ax/dsp/program.ts:70](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl70)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `parentId` | `string` |

#### Returns

`void`

#### Inherited from

[`AxTunable`](#apidocs/interfaceaxtunable).[`setParentId`](#apidocs/interfaceaxtunablemdsetparentid)

## Methods

<a id="getFunction"></a>

### getFunction()

> **getFunction**(): [`AxFunction`](#apidocs/typealiasaxfunction)

Defined in: [src/ax/prompts/agent.ts:18](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxpromptsagenttsl18)

#### Returns

[`AxFunction`](#apidocs/typealiasaxfunction)
