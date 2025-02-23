---
title: AxAgentic
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/prompts/agent.ts#L27

Interface for agents that can be used as child agents.
Provides methods to get the agent's function definition and features.

## Extends

- [`AxTunable`](/api/#03-apidocs/interfaceaxtunable).[`AxUsable`](/api/#03-apidocs/interfaceaxusable)

## Properties

<a id="getTraces"></a>

### getTraces()

> **getTraces**: () => [`AxProgramTrace`](/api/#03-apidocs/typealiasaxprogramtrace)[]

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L87

#### Returns

[`AxProgramTrace`](/api/#03-apidocs/typealiasaxprogramtrace)[]

#### Inherited from

[`AxTunable`](/api/#03-apidocs/interfaceaxtunable).[`getTraces`](/api/#03-apidocs/interfaceaxtunablemdgettraces)

***

<a id="getUsage"></a>

### getUsage()

> **getUsage**: () => [`AxTokenUsage`](/api/#03-apidocs/typealiasaxtokenusage) & `object`[]

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L92

#### Returns

[`AxTokenUsage`](/api/#03-apidocs/typealiasaxtokenusage) & `object`[]

#### Inherited from

[`AxUsable`](/api/#03-apidocs/interfaceaxusable).[`getUsage`](/api/#03-apidocs/interfaceaxusablemdgetusage)

***

<a id="resetUsage"></a>

### resetUsage()

> **resetUsage**: () => `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L93

#### Returns

`void`

#### Inherited from

[`AxUsable`](/api/#03-apidocs/interfaceaxusable).[`resetUsage`](/api/#03-apidocs/interfaceaxusablemdresetusage)

***

<a id="setDemos"></a>

### setDemos()

> **setDemos**: (`demos`) => `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L88

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `demos` | readonly [`AxProgramDemos`](/api/#03-apidocs/typealiasaxprogramdemos)[] |

#### Returns

`void`

#### Inherited from

[`AxTunable`](/api/#03-apidocs/interfaceaxtunable).[`setDemos`](/api/#03-apidocs/interfaceaxtunablemdsetdemos)

***

<a id="setExamples"></a>

### setExamples()

> **setExamples**: (`examples`) => `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L84

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `examples` | `Readonly`\<[`AxProgramExamples`](/api/#03-apidocs/typealiasaxprogramexamples)\> |

#### Returns

`void`

#### Inherited from

[`AxTunable`](/api/#03-apidocs/interfaceaxtunable).[`setExamples`](/api/#03-apidocs/interfaceaxtunablemdsetexamples)

***

<a id="setId"></a>

### setId()

> **setId**: (`id`) => `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L85

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

`void`

#### Inherited from

[`AxTunable`](/api/#03-apidocs/interfaceaxtunable).[`setId`](/api/#03-apidocs/interfaceaxtunablemdsetid)

***

<a id="setParentId"></a>

### setParentId()

> **setParentId**: (`parentId`) => `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/program.ts#L86

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `parentId` | `string` |

#### Returns

`void`

#### Inherited from

[`AxTunable`](/api/#03-apidocs/interfaceaxtunable).[`setParentId`](/api/#03-apidocs/interfaceaxtunablemdsetparentid)

## Methods

<a id="getFeatures"></a>

### getFeatures()

> **getFeatures**(): [`AxAgentFeatures`](/api/#03-apidocs/interfaceaxagentfeatures)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/prompts/agent.ts#L29

#### Returns

[`AxAgentFeatures`](/api/#03-apidocs/interfaceaxagentfeatures)

***

<a id="getFunction"></a>

### getFunction()

> **getFunction**(): [`AxFunction`](/api/#03-apidocs/typealiasaxfunction)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/prompts/agent.ts#L28

#### Returns

[`AxFunction`](/api/#03-apidocs/typealiasaxfunction)
