---
title: AxGen
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/generate.ts#L92

## Extends

- [`AxProgramWithSignature`](/api/#03-apidocs/classaxprogramwithsignature)\<`IN`, `OUT`\>

## Extended by

- [`AxChainOfThought`](/api/#03-apidocs/classaxchainofthought)
- [`AxDefaultQueryRewriter`](/api/#03-apidocs/classaxdefaultqueryrewriter)
- [`AxDefaultResultReranker`](/api/#03-apidocs/classaxdefaultresultreranker)
- [`AxRewriter`](/api/#03-apidocs/classaxrewriter)

## Type Parameters

| Type Parameter | Default type |
| :------ | :------ |
| `IN` *extends* [`AxGenIn`](/api/#03-apidocs/typealiasaxgenin) | - |
| `OUT` *extends* [`AxGenerateResult`](/api/#03-apidocs/typealiasaxgenerateresult)\<[`AxGenOut`](/api/#03-apidocs/typealiasaxgenout)\> | [`AxGenerateResult`](/api/#03-apidocs/typealiasaxgenerateresult)\<[`AxGenOut`](/api/#03-apidocs/typealiasaxgenout)\> |

## Constructors

<a id="constructors"></a>

### new AxGen()

```ts
new AxGen<IN, OUT>(signature: Readonly<string | AxSignature>, options?: Readonly<AxProgramForwardOptions>): AxGen<IN, OUT>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/generate.ts#L109

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `signature` | `Readonly`\<`string` \| [`AxSignature`](/api/#03-apidocs/classaxsignature)\> |
| `options`? | `Readonly`\<[`AxProgramForwardOptions`](/api/#03-apidocs/typealiasaxprogramforwardoptions)\> |

#### Returns

[`AxGen`](/api/#03-apidocs/classaxgen)\<`IN`, `OUT`\>

#### Overrides

[`AxProgramWithSignature`](/api/#03-apidocs/classaxprogramwithsignature).[`constructor`](/api/#03-apidocs/classaxprogramwithsignaturemdconstructors)

## Methods

<a id="_forward1"></a>

### \_forward1()

```ts
_forward1(
   ai: Readonly<AxAIService<unknown, unknown>>, 
   values: IN | AxMessage<IN>[], 
   options: Readonly<AxProgramForwardOptions>): AsyncGenerator<{
  delta: Partial<OUT>;
  version: number;
}, void, unknown>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/generate.ts#L746

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `ai` | `Readonly`\<[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)\<`unknown`, `unknown`\>\> |
| `values` | `IN` \| [`AxMessage`](/api/#03-apidocs/typealiasaxmessage)\<`IN`\>[] |
| `options` | `Readonly`\<[`AxProgramForwardOptions`](/api/#03-apidocs/typealiasaxprogramforwardoptions)\> |

#### Returns

`AsyncGenerator`\<\{
  `delta`: `Partial`\<`OUT`\>;
  `version`: `number`;
 \}, `void`, `unknown`\>

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

***

<a id="forward"></a>

### forward()

```ts
forward(
   ai: Readonly<AxAIService<unknown, unknown>>, 
   values: IN | AxMessage<IN>[], 
options?: Readonly<AxProgramForwardOptions>): Promise<OUT>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/generate.ts#L823

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `ai` | `Readonly`\<[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)\<`unknown`, `unknown`\>\> |
| `values` | `IN` \| [`AxMessage`](/api/#03-apidocs/typealiasaxmessage)\<`IN`\>[] |
| `options`? | `Readonly`\<[`AxProgramForwardOptions`](/api/#03-apidocs/typealiasaxprogramforwardoptions)\> |

#### Returns

`Promise`\<`OUT`\>

#### Overrides

[`AxProgramWithSignature`](/api/#03-apidocs/classaxprogramwithsignature).[`forward`](/api/#03-apidocs/classaxprogramwithsignaturemdforward)

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

[`AxProgramWithSignature`](/api/#03-apidocs/classaxprogramwithsignature).[`getSignature`](/api/#03-apidocs/classaxprogramwithsignaturemdgetsignature)

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

[`AxProgramWithSignature`](/api/#03-apidocs/classaxprogramwithsignature).[`getTraces`](/api/#03-apidocs/classaxprogramwithsignaturemdgettraces)

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

[`AxProgramWithSignature`](/api/#03-apidocs/classaxprogramwithsignature).[`getUsage`](/api/#03-apidocs/classaxprogramwithsignaturemdgetusage)

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

[`AxProgramWithSignature`](/api/#03-apidocs/classaxprogramwithsignature).[`register`](/api/#03-apidocs/classaxprogramwithsignaturemdregister)

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

[`AxProgramWithSignature`](/api/#03-apidocs/classaxprogramwithsignature).[`resetUsage`](/api/#03-apidocs/classaxprogramwithsignaturemdresetusage)

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

[`AxProgramWithSignature`](/api/#03-apidocs/classaxprogramwithsignature).[`setDemos`](/api/#03-apidocs/classaxprogramwithsignaturemdsetdemos)

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

#### Overrides

[`AxProgramWithSignature`](/api/#03-apidocs/classaxprogramwithsignature).[`setExamples`](/api/#03-apidocs/classaxprogramwithsignaturemdsetexamples)

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

[`AxProgramWithSignature`](/api/#03-apidocs/classaxprogramwithsignature).[`setId`](/api/#03-apidocs/classaxprogramwithsignaturemdsetid)

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

[`AxProgramWithSignature`](/api/#03-apidocs/classaxprogramwithsignature).[`setParentId`](/api/#03-apidocs/classaxprogramwithsignaturemdsetparentid)

***

<a id="streamingForward"></a>

### streamingForward()

```ts
streamingForward(
   ai: Readonly<AxAIService<unknown, unknown>>, 
   values: IN | AxMessage<IN>[], 
   options?: Readonly<AxProgramStreamingForwardOptions>): AsyncGenerator<{
  delta: Partial<OUT>;
  version: number;
}, void, unknown>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/generate.ts#L845

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `ai` | `Readonly`\<[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)\<`unknown`, `unknown`\>\> |
| `values` | `IN` \| [`AxMessage`](/api/#03-apidocs/typealiasaxmessage)\<`IN`\>[] |
| `options`? | `Readonly`\<[`AxProgramStreamingForwardOptions`](/api/#03-apidocs/typealiasaxprogramstreamingforwardoptions)\> |

#### Returns

`AsyncGenerator`\<\{
  `delta`: `Partial`\<`OUT`\>;
  `version`: `number`;
 \}, `void`, `unknown`\>

#### Overrides

[`AxProgramWithSignature`](/api/#03-apidocs/classaxprogramwithsignature).[`streamingForward`](/api/#03-apidocs/classaxprogramwithsignaturemdstreamingforward)
