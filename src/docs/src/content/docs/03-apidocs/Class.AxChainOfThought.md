---
title: AxChainOfThought
---

Defined in: [src/ax/prompts/cot.ts:5](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxpromptscottsl5)

## Extends

- [`AxGen`](#apidocs/classaxgen)\<`IN`, `OUT` & `object`\>

## Extended by

- [`AxRAG`](#apidocs/classaxrag)

## Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `IN` *extends* [`AxGenIn`](#apidocs/typealiasaxgenin) | [`AxGenIn`](#apidocs/typealiasaxgenin) |
| `OUT` *extends* [`AxGenOut`](#apidocs/typealiasaxgenout) | [`AxGenOut`](#apidocs/typealiasaxgenout) |

## Constructors

<a id="Constructors"></a>

### new AxChainOfThought()

> **new AxChainOfThought**\<`IN`, `OUT`\>(`signature`, `options`?): [`AxChainOfThought`](#apidocs/classaxchainofthought)\<`IN`, `OUT`\>

Defined in: [src/ax/prompts/cot.ts:9](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxpromptscottsl9)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `signature` | `Readonly`\<`string` \| [`AxSignature`](#apidocs/classaxsignature)\> |
| `options`? | `Readonly`\<[`AxGenOptions`](#apidocs/interfaceaxgenoptions)\> |

#### Returns

[`AxChainOfThought`](#apidocs/classaxchainofthought)\<`IN`, `OUT`\>

#### Overrides

[`AxGen`](#apidocs/classaxgen).[`constructor`](#apidocs/classaxgenmdconstructors)

## Methods

<a id="addAssert"></a>

### addAssert()

> **addAssert**(`fn`, `message`?, `optional`?): `void`

Defined in: [src/ax/dsp/generate.ts:115](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspgeneratetsl115)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `fn` | (`values`) => `undefined` \| `boolean` |
| `message`? | `string` |
| `optional`? | `boolean` |

#### Returns

`void`

#### Inherited from

[`AxGen`](#apidocs/classaxgen).[`addAssert`](#apidocs/classaxgenmdaddassert)

***

<a id="addStreamingAssert"></a>

### addStreamingAssert()

> **addStreamingAssert**(`fieldName`, `fn`, `message`?, `optional`?): `void`

Defined in: [src/ax/dsp/generate.ts:123](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspgeneratetsl123)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `fieldName` | `string` |
| `fn` | (`content`, `done`?) => `undefined` \| `boolean` |
| `message`? | `string` |
| `optional`? | `boolean` |

#### Returns

`void`

#### Inherited from

[`AxGen`](#apidocs/classaxgen).[`addStreamingAssert`](#apidocs/classaxgenmdaddstreamingassert)

***

<a id="forward"></a>

### forward()

> **forward**(`ai`, `values`, `options`?): `Promise`\<`OUT` & `object`\>

Defined in: [src/ax/dsp/generate.ts:453](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspgeneratetsl453)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ai` | `Readonly`\<[`AxAIService`](#apidocs/interfaceaxaiservice)\> |
| `values` | `IN` |
| `options`? | `Readonly`\<[`AxProgramForwardOptions`](#apidocs/typealiasaxprogramforwardoptions)\> |

#### Returns

`Promise`\<`OUT` & `object`\>

#### Inherited from

[`AxGen`](#apidocs/classaxgen).[`forward`](#apidocs/classaxgenmdforward)

***

<a id="getSignature"></a>

### getSignature()

> **getSignature**(): [`AxSignature`](#apidocs/classaxsignature)

Defined in: [src/ax/dsp/program.ts:117](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl117)

#### Returns

[`AxSignature`](#apidocs/classaxsignature)

#### Inherited from

[`AxGen`](#apidocs/classaxgen).[`getSignature`](#apidocs/classaxgenmdgetsignature)

***

<a id="getTraces"></a>

### getTraces()

> **getTraces**(): [`AxProgramTrace`](#apidocs/typealiasaxprogramtrace)[]

Defined in: [src/ax/dsp/program.ts:193](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl193)

#### Returns

[`AxProgramTrace`](#apidocs/typealiasaxprogramtrace)[]

#### Inherited from

[`AxGen`](#apidocs/classaxgen).[`getTraces`](#apidocs/classaxgenmdgettraces)

***

<a id="getUsage"></a>

### getUsage()

> **getUsage**(): [`AxTokenUsage`](#apidocs/typealiasaxtokenusage) & `object`[]

Defined in: [src/ax/dsp/program.ts:207](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl207)

#### Returns

[`AxTokenUsage`](#apidocs/typealiasaxtokenusage) & `object`[]

#### Inherited from

[`AxGen`](#apidocs/classaxgen).[`getUsage`](#apidocs/classaxgenmdgetusage)

***

<a id="register"></a>

### register()

> **register**(`prog`): `void`

Defined in: [src/ax/dsp/program.ts:121](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl121)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `prog` | `Readonly`\<[`AxTunable`](#apidocs/interfaceaxtunable) & [`AxUsable`](#apidocs/interfaceaxusable)\> |

#### Returns

`void`

#### Inherited from

[`AxGen`](#apidocs/classaxgen).[`register`](#apidocs/classaxgenmdregister)

***

<a id="resetUsage"></a>

### resetUsage()

> **resetUsage**(): `void`

Defined in: [src/ax/dsp/program.ts:217](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl217)

#### Returns

`void`

#### Inherited from

[`AxGen`](#apidocs/classaxgen).[`resetUsage`](#apidocs/classaxgenmdresetusage)

***

<a id="setDemos"></a>

### setDemos()

> **setDemos**(`demos`): `void`

Defined in: [src/ax/dsp/program.ts:224](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl224)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `demos` | readonly [`AxProgramDemos`](#apidocs/typealiasaxprogramdemos)[] |

#### Returns

`void`

#### Inherited from

[`AxGen`](#apidocs/classaxgen).[`setDemos`](#apidocs/classaxgenmdsetdemos)

***

<a id="setExamples"></a>

### setExamples()

> **setExamples**(`examples`): `void`

Defined in: [src/ax/dsp/program.ts:152](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl152)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `examples` | `Readonly`\<[`AxProgramExamples`](#apidocs/typealiasaxprogramexamples)\> |

#### Returns

`void`

#### Inherited from

[`AxGen`](#apidocs/classaxgen).[`setExamples`](#apidocs/classaxgenmdsetexamples)

***

<a id="setId"></a>

### setId()

> **setId**(`id`): `void`

Defined in: [src/ax/dsp/program.ts:139](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl139)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

`void`

#### Inherited from

[`AxGen`](#apidocs/classaxgen).[`setId`](#apidocs/classaxgenmdsetid)

***

<a id="setParentId"></a>

### setParentId()

> **setParentId**(`parentId`): `void`

Defined in: [src/ax/dsp/program.ts:146](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl146)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `parentId` | `string` |

#### Returns

`void`

#### Inherited from

[`AxGen`](#apidocs/classaxgen).[`setParentId`](#apidocs/classaxgenmdsetparentid)
