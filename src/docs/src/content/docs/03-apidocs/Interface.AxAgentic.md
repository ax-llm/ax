---
title: AxAgentic
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/prompts/agent.ts#L28

Interface for agents that can be used as child agents.
Provides methods to get the agent's function definition and features.

## Extends

- [`AxTunable`](/api/#03-apidocs/interfaceaxtunable).[`AxUsable`](/api/#03-apidocs/interfaceaxusable)

## Properties

| Property | Type | Inherited from |
| :------ | :------ | :------ |
| <a id="getTraces"></a> `getTraces` | () => [`AxProgramTrace`](/api/#03-apidocs/typealiasaxprogramtrace)[] | [`AxTunable`](/api/#03-apidocs/interfaceaxtunable).[`getTraces`](/api/#03-apidocs/interfaceaxtunablemdgettraces) |
| <a id="getUsage"></a> `getUsage` | () => [`AxModelUsage`](/api/#03-apidocs/typealiasaxmodelusage) & `object`[] | [`AxUsable`](/api/#03-apidocs/interfaceaxusable).[`getUsage`](/api/#03-apidocs/interfaceaxusablemdgetusage) |
| <a id="resetUsage"></a> `resetUsage` | () => `void` | [`AxUsable`](/api/#03-apidocs/interfaceaxusable).[`resetUsage`](/api/#03-apidocs/interfaceaxusablemdresetusage) |
| <a id="setDemos"></a> `setDemos` | (`demos`: readonly [`AxProgramDemos`](/api/#03-apidocs/typealiasaxprogramdemos)[]) => `void` | [`AxTunable`](/api/#03-apidocs/interfaceaxtunable).[`setDemos`](/api/#03-apidocs/interfaceaxtunablemdsetdemos) |
| <a id="setExamples"></a> `setExamples` | (`examples`: `Readonly`\<[`AxProgramExamples`](/api/#03-apidocs/typealiasaxprogramexamples)\>, `options`?: `Readonly`\<[`AxSetExamplesOptions`](/api/#03-apidocs/typealiasaxsetexamplesoptions)\>) => `void` | [`AxTunable`](/api/#03-apidocs/interfaceaxtunable).[`setExamples`](/api/#03-apidocs/interfaceaxtunablemdsetexamples) |
| <a id="setId"></a> `setId` | (`id`: `string`) => `void` | [`AxTunable`](/api/#03-apidocs/interfaceaxtunable).[`setId`](/api/#03-apidocs/interfaceaxtunablemdsetid) |
| <a id="setParentId"></a> `setParentId` | (`parentId`: `string`) => `void` | [`AxTunable`](/api/#03-apidocs/interfaceaxtunable).[`setParentId`](/api/#03-apidocs/interfaceaxtunablemdsetparentid) |

## Methods

<a id="getFeatures"></a>

### getFeatures()

```ts
getFeatures(): AxAgentFeatures
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/prompts/agent.ts#L30

#### Returns

[`AxAgentFeatures`](/api/#03-apidocs/interfaceaxagentfeatures)

***

<a id="getFunction"></a>

### getFunction()

```ts
getFunction(): AxFunction
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/prompts/agent.ts#L29

#### Returns

[`AxFunction`](/api/#03-apidocs/typealiasaxfunction)
