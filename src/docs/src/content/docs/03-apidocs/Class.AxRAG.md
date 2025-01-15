---
title: AxRAG
---

Defined in: [src/ax/prompts/rag.ts:12](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxpromptsragtsl12)

## Extends

- [`AxChainOfThought`](#apidocs/classaxchainofthought)\<\{ `context`: `string`[]; `question`: `string`; \}, \{ `answer`: `string`; \}\>

## Constructors

<a id="Constructors"></a>

### new AxRAG()

> **new AxRAG**(`queryFn`, `options`): [`AxRAG`](#apidocs/classaxrag)

Defined in: [src/ax/prompts/rag.ts:23](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxpromptsragtsl23)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `queryFn` | (`query`) => `Promise`\<`string`\> |
| `options` | `Readonly`\<[`AxGenOptions`](#apidocs/interfaceaxgenoptions) & `object`\> |

#### Returns

[`AxRAG`](#apidocs/classaxrag)

#### Overrides

[`AxChainOfThought`](#apidocs/classaxchainofthought).[`constructor`](#apidocs/classaxchainofthoughtmdconstructors)

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

[`AxChainOfThought`](#apidocs/classaxchainofthought).[`addAssert`](#apidocs/classaxchainofthoughtmdaddassert)

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

[`AxChainOfThought`](#apidocs/classaxchainofthought).[`addStreamingAssert`](#apidocs/classaxchainofthoughtmdaddstreamingassert)

***

<a id="forward"></a>

### forward()

> **forward**(`ai`, `__namedParameters`, `options`?): `Promise`\<\{ `answer`: `string`; `reason`: `string`; \}\>

Defined in: [src/ax/prompts/rag.ts:44](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxpromptsragtsl44)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ai` | `Readonly`\<[`AxAIService`](#apidocs/interfaceaxaiservice)\> |
| `__namedParameters` | `Readonly`\<\{ `question`: `string`; \}\> |
| `options`? | `Readonly`\<[`AxProgramForwardOptions`](#apidocs/typealiasaxprogramforwardoptions)\> |

#### Returns

`Promise`\<\{ `answer`: `string`; `reason`: `string`; \}\>

#### Overrides

[`AxChainOfThought`](#apidocs/classaxchainofthought).[`forward`](#apidocs/classaxchainofthoughtmdforward)

***

<a id="getSignature"></a>

### getSignature()

> **getSignature**(): [`AxSignature`](#apidocs/classaxsignature)

Defined in: [src/ax/dsp/program.ts:117](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl117)

#### Returns

[`AxSignature`](#apidocs/classaxsignature)

#### Inherited from

[`AxChainOfThought`](#apidocs/classaxchainofthought).[`getSignature`](#apidocs/classaxchainofthoughtmdgetsignature)

***

<a id="getTraces"></a>

### getTraces()

> **getTraces**(): [`AxProgramTrace`](#apidocs/typealiasaxprogramtrace)[]

Defined in: [src/ax/dsp/program.ts:193](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl193)

#### Returns

[`AxProgramTrace`](#apidocs/typealiasaxprogramtrace)[]

#### Inherited from

[`AxChainOfThought`](#apidocs/classaxchainofthought).[`getTraces`](#apidocs/classaxchainofthoughtmdgettraces)

***

<a id="getUsage"></a>

### getUsage()

> **getUsage**(): [`AxTokenUsage`](#apidocs/typealiasaxtokenusage) & `object`[]

Defined in: [src/ax/dsp/program.ts:207](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl207)

#### Returns

[`AxTokenUsage`](#apidocs/typealiasaxtokenusage) & `object`[]

#### Inherited from

[`AxChainOfThought`](#apidocs/classaxchainofthought).[`getUsage`](#apidocs/classaxchainofthoughtmdgetusage)

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

[`AxChainOfThought`](#apidocs/classaxchainofthought).[`register`](#apidocs/classaxchainofthoughtmdregister)

***

<a id="resetUsage"></a>

### resetUsage()

> **resetUsage**(): `void`

Defined in: [src/ax/dsp/program.ts:217](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspprogramtsl217)

#### Returns

`void`

#### Inherited from

[`AxChainOfThought`](#apidocs/classaxchainofthought).[`resetUsage`](#apidocs/classaxchainofthoughtmdresetusage)

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

[`AxChainOfThought`](#apidocs/classaxchainofthought).[`setDemos`](#apidocs/classaxchainofthoughtmdsetdemos)

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

[`AxChainOfThought`](#apidocs/classaxchainofthought).[`setExamples`](#apidocs/classaxchainofthoughtmdsetexamples)

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

[`AxChainOfThought`](#apidocs/classaxchainofthought).[`setId`](#apidocs/classaxchainofthoughtmdsetid)

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

[`AxChainOfThought`](#apidocs/classaxchainofthought).[`setParentId`](#apidocs/classaxchainofthoughtmdsetparentid)
