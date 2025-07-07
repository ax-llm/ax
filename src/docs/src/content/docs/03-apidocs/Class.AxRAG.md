---
title: AxRAG
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/prompts/rag.ts#L8

## Extends

- [`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought)\<\{
  `context`: `string`[];
  `question`: `string`;
 \}, \{
  `answer`: `string`;
 \}\>

## Constructors

<a id="constructors"></a>

### new AxRAG()

```ts
new AxRAG(queryFn: (query: string) => Promise<string>, options: Readonly<AxProgramForwardOptions & object>): AxRAG
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/prompts/rag.ts#L19

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `queryFn` | (`query`: `string`) => `Promise`\<`string`\> |
| `options` | `Readonly`\<[`AxProgramForwardOptions`](/api/#03-apidocs/typealiasaxprogramforwardoptions) & `object`\> |

#### Returns

[`AxRAG`](/api/#03-apidocs/classaxrag)

#### Overrides

[`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought).[`constructor`](/api/#03-apidocs/classaxchainofthoughtmdconstructors)

## Methods

<a id="_forward1"></a>

### \_forward1()

```ts
_forward1(
   ai: Readonly<AxAIService<unknown, unknown>>, 
   values: 
  | {
  context: string[];
  question: string;
 }
  | AxMessage<{
  context: string[];
  question: string;
 }>[], 
   options: Readonly<AxProgramForwardOptions>): AsyncGenerator<{
  delta: Partial<{
     answer: string;
    }>;
  version: number;
}, void, unknown>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/generate.ts#L746

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `ai` | `Readonly`\<[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)\<`unknown`, `unknown`\>\> |
| `values` | \| \{ `context`: `string`[]; `question`: `string`; \} \| [`AxMessage`](/api/#03-apidocs/typealiasaxmessage)\<\{ `context`: `string`[]; `question`: `string`; \}\>[] |
| `options` | `Readonly`\<[`AxProgramForwardOptions`](/api/#03-apidocs/typealiasaxprogramforwardoptions)\> |

#### Returns

`AsyncGenerator`\<\{
  `delta`: `Partial`\<\{
     `answer`: `string`;
    \}\>;
  `version`: `number`;
 \}, `void`, `unknown`\>

#### Inherited from

[`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought).[`_forward1`](/api/#03-apidocs/classaxchainofthoughtmdforward1)

***

<a id="addAssert"></a>

### addAssert()

```ts
addAssert(fn: (values: Record<string, unknown>) => undefined | boolean | Promise<undefined | boolean>, message?: string): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/generate.ts#L136

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `fn` | (`values`: `Record`\<`string`, `unknown`\>) => `undefined` \| `boolean` \| `Promise`\<`undefined` \| `boolean`\> |
| `message`? | `string` |

#### Returns

`void`

#### Inherited from

[`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought).[`addAssert`](/api/#03-apidocs/classaxchainofthoughtmdaddassert)

***

<a id="addFieldProcessor"></a>

### addFieldProcessor()

```ts
addFieldProcessor(fieldName: string, fn: 
  | AxFieldProcessorProcess
  | AxStreamingFieldProcessorProcess): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/generate.ts#L183

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `fieldName` | `string` |
| `fn` | \| [`AxFieldProcessorProcess`](/api/#03-apidocs/typealiasaxfieldprocessorprocess) \| [`AxStreamingFieldProcessorProcess`](/api/#03-apidocs/typealiasaxstreamingfieldprocessorprocess) |

#### Returns

`void`

#### Inherited from

[`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought).[`addFieldProcessor`](/api/#03-apidocs/classaxchainofthoughtmdaddfieldprocessor)

***

<a id="addStreamingAssert"></a>

### addStreamingAssert()

```ts
addStreamingAssert(
   fieldName: string, 
   fn: (content: string, done?: boolean) => undefined | boolean, 
   message?: string): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/generate.ts#L140

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `fieldName` | `string` |
| `fn` | (`content`: `string`, `done`?: `boolean`) => `undefined` \| `boolean` |
| `message`? | `string` |

#### Returns

`void`

#### Inherited from

[`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought).[`addStreamingAssert`](/api/#03-apidocs/classaxchainofthoughtmdaddstreamingassert)

***

<a id="addStreamingFieldProcessor"></a>

### addStreamingFieldProcessor()

```ts
addStreamingFieldProcessor(fieldName: string, fn: 
  | AxFieldProcessorProcess
  | AxStreamingFieldProcessorProcess): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/generate.ts#L176

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `fieldName` | `string` |
| `fn` | \| [`AxFieldProcessorProcess`](/api/#03-apidocs/typealiasaxfieldprocessorprocess) \| [`AxStreamingFieldProcessorProcess`](/api/#03-apidocs/typealiasaxstreamingfieldprocessorprocess) |

#### Returns

`void`

#### Inherited from

[`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought).[`addStreamingFieldProcessor`](/api/#03-apidocs/classaxchainofthoughtmdaddstreamingfieldprocessor)

***

<a id="forward"></a>

### forward()

```ts
forward(
   ai: Readonly<AxAIService<unknown, unknown>>, 
   values: 
  | {
  context: string[];
  question: string;
 }
  | AxMessage<{
  context: string[];
  question: string;
 }>[], 
   options?: Readonly<AxProgramForwardOptions>): Promise<{
  answer: string;
}>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/prompts/rag.ts#L40

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `ai` | `Readonly`\<[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)\<`unknown`, `unknown`\>\> |
| `values` | \| \{ `context`: `string`[]; `question`: `string`; \} \| [`AxMessage`](/api/#03-apidocs/typealiasaxmessage)\<\{ `context`: `string`[]; `question`: `string`; \}\>[] |
| `options`? | `Readonly`\<[`AxProgramForwardOptions`](/api/#03-apidocs/typealiasaxprogramforwardoptions)\> |

#### Returns

`Promise`\<\{
  `answer`: `string`;
 \}\>

#### Overrides

[`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought).[`forward`](/api/#03-apidocs/classaxchainofthoughtmdforward)

***

<a id="getSignature"></a>

### getSignature()

```ts
getSignature(): AxSignature
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/program.ts#L165

#### Returns

[`AxSignature`](/api/#03-apidocs/classaxsignature)

#### Inherited from

[`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought).[`getSignature`](/api/#03-apidocs/classaxchainofthoughtmdgetsignature)

***

<a id="getTraces"></a>

### getTraces()

```ts
getTraces(): AxProgramTrace[]
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/program.ts#L262

#### Returns

[`AxProgramTrace`](/api/#03-apidocs/typealiasaxprogramtrace)[]

#### Inherited from

[`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought).[`getTraces`](/api/#03-apidocs/classaxchainofthoughtmdgettraces)

***

<a id="getUsage"></a>

### getUsage()

```ts
getUsage(): AxModelUsage & object[]
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/program.ts#L276

#### Returns

[`AxModelUsage`](/api/#03-apidocs/typealiasaxmodelusage) & `object`[]

#### Inherited from

[`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought).[`getUsage`](/api/#03-apidocs/classaxchainofthoughtmdgetusage)

***

<a id="register"></a>

### register()

```ts
register(prog: Readonly<AxTunable & AxUsable>): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/program.ts#L169

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `prog` | `Readonly`\<[`AxTunable`](/api/#03-apidocs/interfaceaxtunable) & [`AxUsable`](/api/#03-apidocs/interfaceaxusable)\> |

#### Returns

`void`

#### Inherited from

[`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought).[`register`](/api/#03-apidocs/classaxchainofthoughtmdregister)

***

<a id="resetUsage"></a>

### resetUsage()

```ts
resetUsage(): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/program.ts#L286

#### Returns

`void`

#### Inherited from

[`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought).[`resetUsage`](/api/#03-apidocs/classaxchainofthoughtmdresetusage)

***

<a id="setDemos"></a>

### setDemos()

```ts
setDemos(demos: readonly AxProgramDemos[]): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/program.ts#L293

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `demos` | readonly [`AxProgramDemos`](/api/#03-apidocs/typealiasaxprogramdemos)[] |

#### Returns

`void`

#### Inherited from

[`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought).[`setDemos`](/api/#03-apidocs/classaxchainofthoughtmdsetdemos)

***

<a id="setExamples"></a>

### setExamples()

```ts
setExamples(examples: Readonly<AxProgramExamples>, options?: Readonly<AxSetExamplesOptions>): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/generate.ts#L856

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `examples` | `Readonly`\<[`AxProgramExamples`](/api/#03-apidocs/typealiasaxprogramexamples)\> |
| `options`? | `Readonly`\<[`AxSetExamplesOptions`](/api/#03-apidocs/typealiasaxsetexamplesoptions)\> |

#### Returns

`void`

#### Inherited from

[`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought).[`setExamples`](/api/#03-apidocs/classaxchainofthoughtmdsetexamples)

***

<a id="setId"></a>

### setId()

```ts
setId(id: string): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/program.ts#L199

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `id` | `string` |

#### Returns

`void`

#### Inherited from

[`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought).[`setId`](/api/#03-apidocs/classaxchainofthoughtmdsetid)

***

<a id="setParentId"></a>

### setParentId()

```ts
setParentId(parentId: string): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/program.ts#L206

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `parentId` | `string` |

#### Returns

`void`

#### Inherited from

[`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought).[`setParentId`](/api/#03-apidocs/classaxchainofthoughtmdsetparentid)

***

<a id="streamingForward"></a>

### streamingForward()

```ts
streamingForward(
   ai: Readonly<AxAIService<unknown, unknown>>, 
   values: 
  | {
  context: string[];
  question: string;
 }
  | AxMessage<{
  context: string[];
  question: string;
 }>[], 
   options?: Readonly<AxProgramStreamingForwardOptions>): AsyncGenerator<{
  delta: Partial<{
     answer: string;
    }>;
  version: number;
}, void, unknown>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/generate.ts#L845

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `ai` | `Readonly`\<[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)\<`unknown`, `unknown`\>\> |
| `values` | \| \{ `context`: `string`[]; `question`: `string`; \} \| [`AxMessage`](/api/#03-apidocs/typealiasaxmessage)\<\{ `context`: `string`[]; `question`: `string`; \}\>[] |
| `options`? | `Readonly`\<[`AxProgramStreamingForwardOptions`](/api/#03-apidocs/typealiasaxprogramstreamingforwardoptions)\> |

#### Returns

`AsyncGenerator`\<\{
  `delta`: `Partial`\<\{
     `answer`: `string`;
    \}\>;
  `version`: `number`;
 \}, `void`, `unknown`\>

#### Inherited from

[`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought).[`streamingForward`](/api/#03-apidocs/classaxchainofthoughtmdstreamingforward)
