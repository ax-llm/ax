---
title: AxDefaultResultReranker
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/docs/reranker.ts#L8

## Extends

- [`AxGen`](/api/#03-apidocs/classaxgen)\<[`AxRerankerIn`](/api/#03-apidocs/typealiasaxrerankerin), [`AxRerankerOut`](/api/#03-apidocs/typealiasaxrerankerout)\>

## Constructors

<a id="constructors"></a>

### new AxDefaultResultReranker()

```ts
new AxDefaultResultReranker(options?: Readonly<AxProgramForwardOptions>): AxDefaultResultReranker
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/docs/reranker.ts#L12

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `options`? | `Readonly`\<[`AxProgramForwardOptions`](/api/#03-apidocs/typealiasaxprogramforwardoptions)\> |

#### Returns

[`AxDefaultResultReranker`](/api/#03-apidocs/classaxdefaultresultreranker)

#### Overrides

[`AxGen`](/api/#03-apidocs/classaxgen).[`constructor`](/api/#03-apidocs/classaxgenmdconstructors)

## Methods

<a id="_forward1"></a>

### \_forward1()

```ts
_forward1(
   ai: Readonly<AxAIService<unknown, unknown>>, 
   values: 
  | AxRerankerIn
  | AxMessage<AxRerankerIn>[], 
   options: Readonly<AxProgramForwardOptions>): AsyncGenerator<{
  delta: Partial<AxRerankerOut>;
  version: number;
}, void, unknown>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/generate.ts#L746

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `ai` | `Readonly`\<[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)\<`unknown`, `unknown`\>\> |
| `values` | \| [`AxRerankerIn`](/api/#03-apidocs/typealiasaxrerankerin) \| [`AxMessage`](/api/#03-apidocs/typealiasaxmessage)\<[`AxRerankerIn`](/api/#03-apidocs/typealiasaxrerankerin)\>[] |
| `options` | `Readonly`\<[`AxProgramForwardOptions`](/api/#03-apidocs/typealiasaxprogramforwardoptions)\> |

#### Returns

`AsyncGenerator`\<\{
  `delta`: `Partial`\<[`AxRerankerOut`](/api/#03-apidocs/typealiasaxrerankerout)\>;
  `version`: `number`;
 \}, `void`, `unknown`\>

#### Inherited from

[`AxGen`](/api/#03-apidocs/classaxgen).[`_forward1`](/api/#03-apidocs/classaxgenmdforward1)

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

[`AxGen`](/api/#03-apidocs/classaxgen).[`addAssert`](/api/#03-apidocs/classaxgenmdaddassert)

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

[`AxGen`](/api/#03-apidocs/classaxgen).[`addFieldProcessor`](/api/#03-apidocs/classaxgenmdaddfieldprocessor)

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

[`AxGen`](/api/#03-apidocs/classaxgen).[`addStreamingAssert`](/api/#03-apidocs/classaxgenmdaddstreamingassert)

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

[`AxGen`](/api/#03-apidocs/classaxgen).[`addStreamingFieldProcessor`](/api/#03-apidocs/classaxgenmdaddstreamingfieldprocessor)

***

<a id="forward"></a>

### forward()

```ts
forward(
   ai: Readonly<AxAIService<unknown, unknown>>, 
   input: Readonly<AxRerankerIn>, 
options?: Readonly<AxProgramForwardOptions>): Promise<AxRerankerOut>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/docs/reranker.ts#L19

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `ai` | `Readonly`\<[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)\<`unknown`, `unknown`\>\> |
| `input` | `Readonly`\<[`AxRerankerIn`](/api/#03-apidocs/typealiasaxrerankerin)\> |
| `options`? | `Readonly`\<[`AxProgramForwardOptions`](/api/#03-apidocs/typealiasaxprogramforwardoptions)\> |

#### Returns

`Promise`\<[`AxRerankerOut`](/api/#03-apidocs/typealiasaxrerankerout)\>

#### Overrides

[`AxGen`](/api/#03-apidocs/classaxgen).[`forward`](/api/#03-apidocs/classaxgenmdforward)

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

[`AxGen`](/api/#03-apidocs/classaxgen).[`getSignature`](/api/#03-apidocs/classaxgenmdgetsignature)

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

[`AxGen`](/api/#03-apidocs/classaxgen).[`getTraces`](/api/#03-apidocs/classaxgenmdgettraces)

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

[`AxGen`](/api/#03-apidocs/classaxgen).[`getUsage`](/api/#03-apidocs/classaxgenmdgetusage)

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

[`AxGen`](/api/#03-apidocs/classaxgen).[`register`](/api/#03-apidocs/classaxgenmdregister)

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

[`AxGen`](/api/#03-apidocs/classaxgen).[`resetUsage`](/api/#03-apidocs/classaxgenmdresetusage)

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

[`AxGen`](/api/#03-apidocs/classaxgen).[`setDemos`](/api/#03-apidocs/classaxgenmdsetdemos)

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

[`AxGen`](/api/#03-apidocs/classaxgen).[`setExamples`](/api/#03-apidocs/classaxgenmdsetexamples)

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

[`AxGen`](/api/#03-apidocs/classaxgen).[`setId`](/api/#03-apidocs/classaxgenmdsetid)

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

[`AxGen`](/api/#03-apidocs/classaxgen).[`setParentId`](/api/#03-apidocs/classaxgenmdsetparentid)

***

<a id="streamingForward"></a>

### streamingForward()

```ts
streamingForward(
   ai: Readonly<AxAIService<unknown, unknown>>, 
   values: 
  | AxRerankerIn
  | AxMessage<AxRerankerIn>[], 
   options?: Readonly<AxProgramStreamingForwardOptions>): AsyncGenerator<{
  delta: Partial<AxRerankerOut>;
  version: number;
}, void, unknown>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/generate.ts#L845

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `ai` | `Readonly`\<[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)\<`unknown`, `unknown`\>\> |
| `values` | \| [`AxRerankerIn`](/api/#03-apidocs/typealiasaxrerankerin) \| [`AxMessage`](/api/#03-apidocs/typealiasaxmessage)\<[`AxRerankerIn`](/api/#03-apidocs/typealiasaxrerankerin)\>[] |
| `options`? | `Readonly`\<[`AxProgramStreamingForwardOptions`](/api/#03-apidocs/typealiasaxprogramstreamingforwardoptions)\> |

#### Returns

`AsyncGenerator`\<\{
  `delta`: `Partial`\<[`AxRerankerOut`](/api/#03-apidocs/typealiasaxrerankerout)\>;
  `version`: `number`;
 \}, `void`, `unknown`\>

#### Inherited from

[`AxGen`](/api/#03-apidocs/classaxgen).[`streamingForward`](/api/#03-apidocs/classaxgenmdstreamingforward)
