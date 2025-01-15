---
title: AxGen
---

Defined in: [src/ax/dsp/generate.ts:84](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspgeneratetsl84)

## Extends

- [`AxProgramWithSignature`](#apidocs/classaxprogramwithsignature)\<`IN`, `OUT`\>

## Extended by

- [`AxChainOfThought`](#apidocs/classaxchainofthought)
- [`AxDefaultQueryRewriter`](#apidocs/classaxdefaultqueryrewriter)
- [`AxDefaultResultReranker`](#apidocs/classaxdefaultresultreranker)

## Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `IN` *extends* [`AxGenIn`](#apidocs/typealiasaxgenin) | [`AxGenIn`](#apidocs/typealiasaxgenin) |
| `OUT` *extends* [`AxGenerateResult`](#apidocs/typealiasaxgenerateresult)\<[`AxGenOut`](#apidocs/typealiasaxgenout)\> | [`AxGenerateResult`](#apidocs/typealiasaxgenerateresult)\<[`AxGenOut`](#apidocs/typealiasaxgenout)\> |

## Constructors

<a id="Constructors"></a>

### new AxGen()

> **new AxGen**\<`IN`, `OUT`\>(`signature`, `options`?): [`AxGen`](#apidocs/classaxgen)\<`IN`, `OUT`\>

Defined in: [src/ax/dsp/generate.ts:95](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspgeneratetsl95)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `signature` | `Readonly`\<`string` \| [`AxSignature`](#apidocs/classaxsignature)\> |
| `options`? | `Readonly`\<[`AxGenOptions`](#apidocs/interfaceaxgenoptions)\> |

#### Returns

[`AxGen`](#apidocs/classaxgen)\<`IN`, `OUT`\>

#### Overrides

[`AxProgramWithSignature`](#apidocs/classaxprogramwithsignature).[`constructor`](#apidocs/classaxprogramwithsignaturemdconstructors)

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

***

<a id="forward"></a>

### forward()

> **forward**(`ai`, `values`, `options`?): `Promise`\<`OUT`\>

Defined in: [src/ax/dsp/generate.ts:453](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspgeneratetsl453)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ai` | `Readonly`\<[`AxAIService`](#apidocs/interfaceaxaiservice)\> |
| `values` | `IN` |
| `options`? | `Readonly`\<[`AxProgramForwardOptions`](#apidocs/typealiasaxprogramforwardoptions)\> |

#### Returns

`Promise`\<`OUT`\>

#### Overrides

[`AxProgramWithSignature`](#apidocs/classaxprogramwithsignature).[`forward`](#apidocs/classaxprogramwithsignaturemdforward)

***

<a id="getSignature"></a>

### getSignature()

> **getSignature**(): [`AxSignature`](#apidocs/classaxsignature)

Defined in: [src/ax/dsp/program.ts:117](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl117)

#### Returns

[`AxSignature`](#apidocs/classaxsignature)

#### Inherited from

[`AxProgramWithSignature`](#apidocs/classaxprogramwithsignature).[`getSignature`](#apidocs/classaxprogramwithsignaturemdgetsignature)

***

<a id="getTraces"></a>

### getTraces()

> **getTraces**(): [`AxProgramTrace`](#apidocs/typealiasaxprogramtrace)[]

Defined in: [src/ax/dsp/program.ts:193](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl193)

#### Returns

[`AxProgramTrace`](#apidocs/typealiasaxprogramtrace)[]

#### Inherited from

[`AxProgramWithSignature`](#apidocs/classaxprogramwithsignature).[`getTraces`](#apidocs/classaxprogramwithsignaturemdgettraces)

***

<a id="getUsage"></a>

### getUsage()

> **getUsage**(): [`AxTokenUsage`](#apidocs/typealiasaxtokenusage) & `object`[]

Defined in: [src/ax/dsp/program.ts:207](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl207)

#### Returns

[`AxTokenUsage`](#apidocs/typealiasaxtokenusage) & `object`[]

#### Inherited from

[`AxProgramWithSignature`](#apidocs/classaxprogramwithsignature).[`getUsage`](#apidocs/classaxprogramwithsignaturemdgetusage)

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

[`AxProgramWithSignature`](#apidocs/classaxprogramwithsignature).[`register`](#apidocs/classaxprogramwithsignaturemdregister)

***

<a id="resetUsage"></a>

### resetUsage()

> **resetUsage**(): `void`

Defined in: [src/ax/dsp/program.ts:217](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl217)

#### Returns

`void`

#### Inherited from

[`AxProgramWithSignature`](#apidocs/classaxprogramwithsignature).[`resetUsage`](#apidocs/classaxprogramwithsignaturemdresetusage)

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

[`AxProgramWithSignature`](#apidocs/classaxprogramwithsignature).[`setDemos`](#apidocs/classaxprogramwithsignaturemdsetdemos)

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

[`AxProgramWithSignature`](#apidocs/classaxprogramwithsignature).[`setExamples`](#apidocs/classaxprogramwithsignaturemdsetexamples)

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

[`AxProgramWithSignature`](#apidocs/classaxprogramwithsignature).[`setId`](#apidocs/classaxprogramwithsignaturemdsetid)

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

[`AxProgramWithSignature`](#apidocs/classaxprogramwithsignature).[`setParentId`](#apidocs/classaxprogramwithsignaturemdsetparentid)
