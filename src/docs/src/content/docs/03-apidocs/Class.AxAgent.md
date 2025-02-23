---
title: AxAgent
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/prompts/agent.ts#L134

An AI agent that can process inputs using an AI service and coordinate with child agents.
Supports features like smart model routing and automatic input field passing to child agents.

## Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `IN` *extends* [`AxGenIn`](/api/#03-apidocs/typealiasaxgenin) | - |
| `OUT` *extends* [`AxGenOut`](/api/#03-apidocs/typealiasaxgenout) | [`AxGenOut`](/api/#03-apidocs/typealiasaxgenout) |

## Implements

- [`AxAgentic`](/api/#03-apidocs/interfaceaxagentic)

## Constructors

<a id="constructors"></a>

### new AxAgent()

> **new AxAgent**\<`IN`, `OUT`\>(`__namedParameters`, `options`?): [`AxAgent`](/api/#03-apidocs/classaxagent)\<`IN`, `OUT`\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/prompts/agent.ts#L149

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `__namedParameters` | `Readonly`\<\{ `agents`: [`AxAgentic`](/api/#03-apidocs/interfaceaxagentic)[]; `ai`: `Readonly`\<[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)\<`unknown`, `unknown`\>\>; `definition`: `string`; `description`: `string`; `functions`: [`AxFunction`](/api/#03-apidocs/typealiasaxfunction)[]; `name`: `string`; `signature`: `string` \| [`AxSignature`](/api/#03-apidocs/classaxsignature); \}\> |
| `options`? | `Readonly`\<[`AxAgentOptions`](/api/#03-apidocs/typealiasaxagentoptions)\> |

#### Returns

[`AxAgent`](/api/#03-apidocs/classaxagent)\<`IN`, `OUT`\>

## Methods

<a id="forward"></a>

### forward()

> **forward**(`parentAi`, `values`, `options`?): `Promise`\<`OUT`\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/prompts/agent.ts#L349

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `parentAi` | `Readonly`\<[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)\<`unknown`, `unknown`\>\> |
| `values` | `IN` |
| `options`? | `Readonly`\<[`AxProgramForwardOptions`](/api/#03-apidocs/typealiasaxprogramforwardoptions)\> |

#### Returns

`Promise`\<`OUT`\>

***

<a id="getFeatures"></a>

### getFeatures()

> **getFeatures**(): [`AxAgentFeatures`](/api/#03-apidocs/interfaceaxagentfeatures)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/prompts/agent.ts#L297

#### Returns

[`AxAgentFeatures`](/api/#03-apidocs/interfaceaxagentfeatures)

#### Implementation of

[`AxAgentic`](/api/#03-apidocs/interfaceaxagentic).[`getFeatures`](/api/#03-apidocs/interfaceaxagenticmdgetfeatures)

***

<a id="getFunction"></a>

### getFunction()

> **getFunction**(): [`AxFunction`](/api/#03-apidocs/typealiasaxfunction)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/prompts/agent.ts#L247

#### Returns

[`AxFunction`](/api/#03-apidocs/typealiasaxfunction)

#### Implementation of

[`AxAgentic`](/api/#03-apidocs/interfaceaxagentic).[`getFunction`](/api/#03-apidocs/interfaceaxagenticmdgetfunction)

***

<a id="getTraces"></a>

### getTraces()

> **getTraces**(): [`AxProgramTrace`](/api/#03-apidocs/typealiasaxprogramtrace)[]

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/prompts/agent.ts#L231

#### Returns

[`AxProgramTrace`](/api/#03-apidocs/typealiasaxprogramtrace)[]

#### Implementation of

[`AxAgentic`](/api/#03-apidocs/interfaceaxagentic).[`getTraces`](/api/#03-apidocs/interfaceaxagenticmdgettraces)

***

<a id="getUsage"></a>

### getUsage()

> **getUsage**(): [`AxTokenUsage`](/api/#03-apidocs/typealiasaxtokenusage) & `object`[]

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/prompts/agent.ts#L239

#### Returns

[`AxTokenUsage`](/api/#03-apidocs/typealiasaxtokenusage) & `object`[]

#### Implementation of

[`AxAgentic`](/api/#03-apidocs/interfaceaxagentic).[`getUsage`](/api/#03-apidocs/interfaceaxagenticmdgetusage)

***

<a id="resetUsage"></a>

### resetUsage()

> **resetUsage**(): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/prompts/agent.ts#L243

#### Returns

`void`

#### Implementation of

[`AxAgentic`](/api/#03-apidocs/interfaceaxagentic).[`resetUsage`](/api/#03-apidocs/interfaceaxagenticmdresetusage)

***

<a id="setDefinition"></a>

### setDefinition()

> **setDefinition**(`definition`): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/prompts/agent.ts#L391

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `definition` | `string` |

#### Returns

`void`

***

<a id="setDemos"></a>

### setDemos()

> **setDemos**(`demos`): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/prompts/agent.ts#L235

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `demos` | readonly [`AxProgramDemos`](/api/#03-apidocs/typealiasaxprogramdemos)[] |

#### Returns

`void`

#### Implementation of

[`AxAgentic`](/api/#03-apidocs/interfaceaxagentic).[`setDemos`](/api/#03-apidocs/interfaceaxagenticmdsetdemos)

***

<a id="setDescription"></a>

### setDescription()

> **setDescription**(`description`): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/prompts/agent.ts#L382

Updates the agent's description.
This updates both the stored description and the function's description.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `description` | `string` | New description for the agent (must be at least 20 characters) |

#### Returns

`void`

#### Throws

Error if description is too short

***

<a id="setExamples"></a>

### setExamples()

> **setExamples**(`examples`): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/prompts/agent.ts#L219

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `examples` | `Readonly`\<[`AxProgramExamples`](/api/#03-apidocs/typealiasaxprogramexamples)\> |

#### Returns

`void`

#### Implementation of

[`AxAgentic`](/api/#03-apidocs/interfaceaxagentic).[`setExamples`](/api/#03-apidocs/interfaceaxagenticmdsetexamples)

***

<a id="setId"></a>

### setId()

> **setId**(`id`): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/prompts/agent.ts#L223

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

`void`

#### Implementation of

[`AxAgentic`](/api/#03-apidocs/interfaceaxagentic).[`setId`](/api/#03-apidocs/interfaceaxagenticmdsetid)

***

<a id="setParentId"></a>

### setParentId()

> **setParentId**(`parentId`): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/prompts/agent.ts#L227

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `parentId` | `string` |

#### Returns

`void`

#### Implementation of

[`AxAgentic`](/api/#03-apidocs/interfaceaxagentic).[`setParentId`](/api/#03-apidocs/interfaceaxagenticmdsetparentid)

***

<a id="streamingForward"></a>

### streamingForward()

> **streamingForward**(`parentAi`, `values`, `options`?): [`AxGenStreamingOut`](/api/#03-apidocs/typealiasaxgenstreamingout)\<`OUT`\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/prompts/agent.ts#L362

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `parentAi` | `Readonly`\<[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)\<`unknown`, `unknown`\>\> |
| `values` | `IN` |
| `options`? | `Readonly`\<[`AxProgramStreamingForwardOptions`](/api/#03-apidocs/typealiasaxprogramstreamingforwardoptions)\> |

#### Returns

[`AxGenStreamingOut`](/api/#03-apidocs/typealiasaxgenstreamingout)\<`OUT`\>
