---
title: AxAgent
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/prompts/agent.ts#L158

An AI agent that can process inputs using an AI service and coordinate with child agents.
Supports features like smart model routing and automatic input field passing to child agents.

## Type Parameters

| Type Parameter | Default type |
| :------ | :------ |
| `IN` *extends* [`AxGenIn`](/api/#03-apidocs/typealiasaxgenin) | - |
| `OUT` *extends* [`AxGenOut`](/api/#03-apidocs/typealiasaxgenout) | [`AxGenOut`](/api/#03-apidocs/typealiasaxgenout) |

## Implements

- [`AxAgentic`](/api/#03-apidocs/interfaceaxagentic)

## Constructors

<a id="constructors"></a>

### new AxAgent()

```ts
new AxAgent<IN, OUT>(__namedParameters: Readonly<{
  agents: AxAgentic[];
  ai: Readonly<AxAIService<unknown, unknown>>;
  definition: string;
  description: string;
  functions: AxInputFunctionType;
  name: string;
  signature: string | AxSignature;
}>, options?: Readonly<AxAgentOptions>): AxAgent<IN, OUT>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/prompts/agent.ts#L173

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `__namedParameters` | `Readonly`\<\{ `agents`: [`AxAgentic`](/api/#03-apidocs/interfaceaxagentic)[]; `ai`: `Readonly`\<[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)\<`unknown`, `unknown`\>\>; `definition`: `string`; `description`: `string`; `functions`: [`AxInputFunctionType`](/api/#03-apidocs/typealiasaxinputfunctiontype); `name`: `string`; `signature`: `string` \| [`AxSignature`](/api/#03-apidocs/classaxsignature); \}\> |
| `options`? | `Readonly`\<[`AxAgentOptions`](/api/#03-apidocs/typealiasaxagentoptions)\> |

#### Returns

[`AxAgent`](/api/#03-apidocs/classaxagent)\<`IN`, `OUT`\>

## Methods

<a id="forward"></a>

### forward()

```ts
forward(
   parentAi: Readonly<AxAIService<unknown, unknown>>, 
   values: IN | AxMessage<IN>[], 
options?: Readonly<AxProgramForwardOptions>): Promise<OUT>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/prompts/agent.ts#L380

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `parentAi` | `Readonly`\<[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)\<`unknown`, `unknown`\>\> |
| `values` | `IN` \| [`AxMessage`](/api/#03-apidocs/typealiasaxmessage)\<`IN`\>[] |
| `options`? | `Readonly`\<[`AxProgramForwardOptions`](/api/#03-apidocs/typealiasaxprogramforwardoptions)\> |

#### Returns

`Promise`\<`OUT`\>

***

<a id="getFeatures"></a>

### getFeatures()

```ts
getFeatures(): AxAgentFeatures
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/prompts/agent.ts#L328

#### Returns

[`AxAgentFeatures`](/api/#03-apidocs/interfaceaxagentfeatures)

#### Implementation of

[`AxAgentic`](/api/#03-apidocs/interfaceaxagentic).[`getFeatures`](/api/#03-apidocs/interfaceaxagenticmdgetfeatures)

***

<a id="getFunction"></a>

### getFunction()

```ts
getFunction(): AxFunction
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/prompts/agent.ts#L274

#### Returns

[`AxFunction`](/api/#03-apidocs/typealiasaxfunction)

#### Implementation of

[`AxAgentic`](/api/#03-apidocs/interfaceaxagentic).[`getFunction`](/api/#03-apidocs/interfaceaxagenticmdgetfunction)

***

<a id="getTraces"></a>

### getTraces()

```ts
getTraces(): AxProgramTrace[]
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/prompts/agent.ts#L258

#### Returns

[`AxProgramTrace`](/api/#03-apidocs/typealiasaxprogramtrace)[]

#### Implementation of

[`AxAgentic`](/api/#03-apidocs/interfaceaxagentic).[`getTraces`](/api/#03-apidocs/interfaceaxagenticmdgettraces)

***

<a id="getUsage"></a>

### getUsage()

```ts
getUsage(): AxModelUsage & object[]
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/prompts/agent.ts#L266

#### Returns

[`AxModelUsage`](/api/#03-apidocs/typealiasaxmodelusage) & `object`[]

#### Implementation of

[`AxAgentic`](/api/#03-apidocs/interfaceaxagentic).[`getUsage`](/api/#03-apidocs/interfaceaxagenticmdgetusage)

***

<a id="resetUsage"></a>

### resetUsage()

```ts
resetUsage(): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/prompts/agent.ts#L270

#### Returns

`void`

#### Implementation of

[`AxAgentic`](/api/#03-apidocs/interfaceaxagentic).[`resetUsage`](/api/#03-apidocs/interfaceaxagenticmdresetusage)

***

<a id="setDefinition"></a>

### setDefinition()

```ts
setDefinition(definition: string): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/prompts/agent.ts#L422

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `definition` | `string` |

#### Returns

`void`

***

<a id="setDemos"></a>

### setDemos()

```ts
setDemos(demos: readonly AxProgramDemos[]): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/prompts/agent.ts#L262

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `demos` | readonly [`AxProgramDemos`](/api/#03-apidocs/typealiasaxprogramdemos)[] |

#### Returns

`void`

#### Implementation of

[`AxAgentic`](/api/#03-apidocs/interfaceaxagentic).[`setDemos`](/api/#03-apidocs/interfaceaxagenticmdsetdemos)

***

<a id="setDescription"></a>

### setDescription()

```ts
setDescription(description: string): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/prompts/agent.ts#L413

Updates the agent's description.
This updates both the stored description and the function's description.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `description` | `string` | New description for the agent (must be at least 20 characters) |

#### Returns

`void`

#### Throws

Error if description is too short

***

<a id="setExamples"></a>

### setExamples()

```ts
setExamples(examples: Readonly<AxProgramExamples>, options?: Readonly<AxSetExamplesOptions>): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/prompts/agent.ts#L243

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `examples` | `Readonly`\<[`AxProgramExamples`](/api/#03-apidocs/typealiasaxprogramexamples)\> |
| `options`? | `Readonly`\<[`AxSetExamplesOptions`](/api/#03-apidocs/typealiasaxsetexamplesoptions)\> |

#### Returns

`void`

#### Implementation of

[`AxAgentic`](/api/#03-apidocs/interfaceaxagentic).[`setExamples`](/api/#03-apidocs/interfaceaxagenticmdsetexamples)

***

<a id="setId"></a>

### setId()

```ts
setId(id: string): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/prompts/agent.ts#L250

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `id` | `string` |

#### Returns

`void`

#### Implementation of

[`AxAgentic`](/api/#03-apidocs/interfaceaxagentic).[`setId`](/api/#03-apidocs/interfaceaxagenticmdsetid)

***

<a id="setParentId"></a>

### setParentId()

```ts
setParentId(parentId: string): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/prompts/agent.ts#L254

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `parentId` | `string` |

#### Returns

`void`

#### Implementation of

[`AxAgentic`](/api/#03-apidocs/interfaceaxagentic).[`setParentId`](/api/#03-apidocs/interfaceaxagenticmdsetparentid)

***

<a id="streamingForward"></a>

### streamingForward()

```ts
streamingForward(
   parentAi: Readonly<AxAIService<unknown, unknown>>, 
   values: IN | AxMessage<IN>[], 
options?: Readonly<AxProgramStreamingForwardOptions>): AxGenStreamingOut<OUT>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/prompts/agent.ts#L393

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `parentAi` | `Readonly`\<[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)\<`unknown`, `unknown`\>\> |
| `values` | `IN` \| [`AxMessage`](/api/#03-apidocs/typealiasaxmessage)\<`IN`\>[] |
| `options`? | `Readonly`\<[`AxProgramStreamingForwardOptions`](/api/#03-apidocs/typealiasaxprogramstreamingforwardoptions)\> |

#### Returns

[`AxGenStreamingOut`](/api/#03-apidocs/typealiasaxgenstreamingout)\<`OUT`\>
