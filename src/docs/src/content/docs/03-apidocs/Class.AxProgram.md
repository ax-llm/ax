---
title: AxProgram
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/program.ts#L306

## Type Parameters

| Type Parameter |
| :------ |
| `IN` *extends* [`AxGenIn`](/api/#03-apidocs/typealiasaxgenin) |
| `OUT` *extends* [`AxGenOut`](/api/#03-apidocs/typealiasaxgenout) |

## Implements

- [`AxTunable`](/api/#03-apidocs/interfaceaxtunable)
- [`AxUsable`](/api/#03-apidocs/interfaceaxusable)

## Constructors

<a id="constructors"></a>

### new AxProgram()

```ts
new AxProgram<IN, OUT>(): AxProgram<IN, OUT>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/program.ts#L315

#### Returns

[`AxProgram`](/api/#03-apidocs/classaxprogram)\<`IN`, `OUT`\>

## Methods

<a id="forward"></a>

### forward()

```ts
forward(
   _ai: Readonly<AxAIService<unknown, unknown>>, 
   _values: IN | AxMessage<IN>[], 
_options?: Readonly<AxProgramForwardOptions>): Promise<OUT>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/program.ts#L327

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `_ai` | `Readonly`\<[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)\<`unknown`, `unknown`\>\> |
| `_values` | `IN` \| [`AxMessage`](/api/#03-apidocs/typealiasaxmessage)\<`IN`\>[] |
| `_options`? | `Readonly`\<[`AxProgramForwardOptions`](/api/#03-apidocs/typealiasaxprogramforwardoptions)\> |

#### Returns

`Promise`\<`OUT`\>

***

<a id="getTraces"></a>

### getTraces()

```ts
getTraces(): AxProgramTrace[]
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/program.ts#L376

#### Returns

[`AxProgramTrace`](/api/#03-apidocs/typealiasaxprogramtrace)[]

#### Implementation of

[`AxTunable`](/api/#03-apidocs/interfaceaxtunable).[`getTraces`](/api/#03-apidocs/interfaceaxtunablemdgettraces)

***

<a id="getUsage"></a>

### getUsage()

```ts
getUsage(): AxModelUsage & object[]
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/program.ts#L390

#### Returns

[`AxModelUsage`](/api/#03-apidocs/typealiasaxmodelusage) & `object`[]

#### Implementation of

[`AxUsable`](/api/#03-apidocs/interfaceaxusable).[`getUsage`](/api/#03-apidocs/interfaceaxusablemdgetusage)

***

<a id="register"></a>

### register()

```ts
register(prog: Readonly<AxTunable & AxUsable>): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/program.ts#L320

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `prog` | `Readonly`\<[`AxTunable`](/api/#03-apidocs/interfaceaxtunable) & [`AxUsable`](/api/#03-apidocs/interfaceaxusable)\> |

#### Returns

`void`

***

<a id="resetUsage"></a>

### resetUsage()

```ts
resetUsage(): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/program.ts#L400

#### Returns

`void`

#### Implementation of

[`AxUsable`](/api/#03-apidocs/interfaceaxusable).[`resetUsage`](/api/#03-apidocs/interfaceaxusablemdresetusage)

***

<a id="setDemos"></a>

### setDemos()

```ts
setDemos(demos: readonly AxProgramDemos[]): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/program.ts#L407

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `demos` | readonly [`AxProgramDemos`](/api/#03-apidocs/typealiasaxprogramdemos)[] |

#### Returns

`void`

#### Implementation of

[`AxTunable`](/api/#03-apidocs/interfaceaxtunable).[`setDemos`](/api/#03-apidocs/interfaceaxtunablemdsetdemos)

***

<a id="setExamples"></a>

### setExamples()

```ts
setExamples(examples: Readonly<AxProgramExamples>, options?: Readonly<AxSetExamplesOptions>): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/program.ts#L363

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `examples` | `Readonly`\<[`AxProgramExamples`](/api/#03-apidocs/typealiasaxprogramexamples)\> |
| `options`? | `Readonly`\<[`AxSetExamplesOptions`](/api/#03-apidocs/typealiasaxsetexamplesoptions)\> |

#### Returns

`void`

#### Implementation of

[`AxTunable`](/api/#03-apidocs/interfaceaxtunable).[`setExamples`](/api/#03-apidocs/interfaceaxtunablemdsetexamples)

***

<a id="setId"></a>

### setId()

```ts
setId(id: string): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/program.ts#L350

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `id` | `string` |

#### Returns

`void`

#### Implementation of

[`AxTunable`](/api/#03-apidocs/interfaceaxtunable).[`setId`](/api/#03-apidocs/interfaceaxtunablemdsetid)

***

<a id="setParentId"></a>

### setParentId()

```ts
setParentId(parentId: string): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/program.ts#L357

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `parentId` | `string` |

#### Returns

`void`

#### Implementation of

[`AxTunable`](/api/#03-apidocs/interfaceaxtunable).[`setParentId`](/api/#03-apidocs/interfaceaxtunablemdsetparentid)

***

<a id="streamingForward"></a>

### streamingForward()

```ts
streamingForward(
   _ai: Readonly<AxAIService<unknown, unknown>>, 
   _values: IN | AxMessage<IN>[], 
_options?: Readonly<AxProgramStreamingForwardOptions>): AxGenStreamingOut<OUT>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/program.ts#L339

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `_ai` | `Readonly`\<[`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)\<`unknown`, `unknown`\>\> |
| `_values` | `IN` \| [`AxMessage`](/api/#03-apidocs/typealiasaxmessage)\<`IN`\>[] |
| `_options`? | `Readonly`\<[`AxProgramStreamingForwardOptions`](/api/#03-apidocs/typealiasaxprogramstreamingforwardoptions)\> |

#### Returns

[`AxGenStreamingOut`](/api/#03-apidocs/typealiasaxgenstreamingout)\<`OUT`\>
