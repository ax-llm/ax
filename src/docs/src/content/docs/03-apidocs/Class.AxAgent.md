---
title: AxAgent
---

Defined in: [src/ax/prompts/agent.ts:23](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxpromptsagenttsl23)

## Type Parameters

| Type Parameter |
| ------ |
| `IN` *extends* [`AxGenIn`](#apidocs/typealiasaxgenin) |
| `OUT` *extends* [`AxGenOut`](#apidocs/typealiasaxgenout) |

## Implements

- [`AxAgentic`](#apidocs/interfaceaxagentic)

## Constructors

<a id="Constructors"></a>

### new AxAgent()

> **new AxAgent**\<`IN`, `OUT`\>(`__namedParameters`, `options`?): [`AxAgent`](#apidocs/classaxagent)\<`IN`, `OUT`\>

Defined in: [src/ax/prompts/agent.ts:36](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxpromptsagenttsl36)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `__namedParameters` | `Readonly`\<\{ `agents`: [`AxAgentic`](#apidocs/interfaceaxagentic)[]; `ai`: `Readonly`\<[`AxAIService`](#apidocs/interfaceaxaiservice)\>; `description`: `string`; `functions`: [`AxFunction`](#apidocs/typealiasaxfunction)[]; `name`: `string`; `signature`: `string` \| [`AxSignature`](#apidocs/classaxsignature); \}\> |
| `options`? | `Readonly`\<[`AxAgentOptions`](#apidocs/typealiasaxagentoptions)\> |

#### Returns

[`AxAgent`](#apidocs/classaxagent)\<`IN`, `OUT`\>

## Methods

<a id="forward"></a>

### forward()

> **forward**(`ai`, `values`, `options`?): `Promise`\<`OUT`\>

Defined in: [src/ax/prompts/agent.ts:145](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxpromptsagenttsl145)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ai` | `Readonly`\<[`AxAIService`](#apidocs/interfaceaxaiservice)\> |
| `values` | `IN` |
| `options`? | `Readonly`\<[`AxProgramForwardOptions`](#apidocs/typealiasaxprogramforwardoptions)\> |

#### Returns

`Promise`\<`OUT`\>

***

<a id="getFunction"></a>

### getFunction()

> **getFunction**(): [`AxFunction`](#apidocs/typealiasaxfunction)

Defined in: [src/ax/prompts/agent.ts:124](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxpromptsagenttsl124)

#### Returns

[`AxFunction`](#apidocs/typealiasaxfunction)

#### Implementation of

[`AxAgentic`](#apidocs/interfaceaxagentic).[`getFunction`](#apidocs/interfaceaxagenticmdgetfunction)

***

<a id="getTraces"></a>

### getTraces()

> **getTraces**(): [`AxProgramTrace`](#apidocs/typealiasaxprogramtrace)[]

Defined in: [src/ax/prompts/agent.ts:108](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxpromptsagenttsl108)

#### Returns

[`AxProgramTrace`](#apidocs/typealiasaxprogramtrace)[]

#### Implementation of

[`AxAgentic`](#apidocs/interfaceaxagentic).[`getTraces`](#apidocs/interfaceaxagenticmdgettraces)

***

<a id="getUsage"></a>

### getUsage()

> **getUsage**(): [`AxTokenUsage`](#apidocs/typealiasaxtokenusage) & `object`[]

Defined in: [src/ax/prompts/agent.ts:116](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxpromptsagenttsl116)

#### Returns

[`AxTokenUsage`](#apidocs/typealiasaxtokenusage) & `object`[]

#### Implementation of

[`AxAgentic`](#apidocs/interfaceaxagentic).[`getUsage`](#apidocs/interfaceaxagenticmdgetusage)

***

<a id="resetUsage"></a>

### resetUsage()

> **resetUsage**(): `void`

Defined in: [src/ax/prompts/agent.ts:120](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxpromptsagenttsl120)

#### Returns

`void`

#### Implementation of

[`AxAgentic`](#apidocs/interfaceaxagentic).[`resetUsage`](#apidocs/interfaceaxagenticmdresetusage)

***

<a id="setDemos"></a>

### setDemos()

> **setDemos**(`demos`): `void`

Defined in: [src/ax/prompts/agent.ts:112](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxpromptsagenttsl112)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `demos` | readonly [`AxProgramDemos`](#apidocs/typealiasaxprogramdemos)[] |

#### Returns

`void`

#### Implementation of

[`AxAgentic`](#apidocs/interfaceaxagentic).[`setDemos`](#apidocs/interfaceaxagenticmdsetdemos)

***

<a id="setExamples"></a>

### setExamples()

> **setExamples**(`examples`): `void`

Defined in: [src/ax/prompts/agent.ts:96](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxpromptsagenttsl96)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `examples` | `Readonly`\<[`AxProgramExamples`](#apidocs/typealiasaxprogramexamples)\> |

#### Returns

`void`

#### Implementation of

[`AxAgentic`](#apidocs/interfaceaxagentic).[`setExamples`](#apidocs/interfaceaxagenticmdsetexamples)

***

<a id="setId"></a>

### setId()

> **setId**(`id`): `void`

Defined in: [src/ax/prompts/agent.ts:100](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxpromptsagenttsl100)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

`void`

#### Implementation of

[`AxAgentic`](#apidocs/interfaceaxagentic).[`setId`](#apidocs/interfaceaxagenticmdsetid)

***

<a id="setParentId"></a>

### setParentId()

> **setParentId**(`parentId`): `void`

Defined in: [src/ax/prompts/agent.ts:104](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxpromptsagenttsl104)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `parentId` | `string` |

#### Returns

`void`

#### Implementation of

[`AxAgentic`](#apidocs/interfaceaxagentic).[`setParentId`](#apidocs/interfaceaxagenticmdsetparentid)
