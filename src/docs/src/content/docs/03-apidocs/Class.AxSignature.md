---
title: AxSignature
---

Defined in: [src/ax/dsp/sig.ts:35](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspsigtsl35)

## Constructors

<a id="Constructors"></a>

### new AxSignature()

> **new AxSignature**(`signature`?): [`AxSignature`](#apidocs/classaxsignature)

Defined in: [src/ax/dsp/sig.ts:43](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspsigtsl43)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `signature`? | `Readonly`\<`string` \| [`AxSignature`](#apidocs/classaxsignature)\> |

#### Returns

[`AxSignature`](#apidocs/classaxsignature)

## Methods

<a id="addInputField"></a>

### addInputField()

> **addInputField**(`field`): `void`

Defined in: [src/ax/dsp/sig.ts:115](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspsigtsl115)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `field` | `Readonly`\<[`AxField`](#apidocs/interfaceaxfield)\> |

#### Returns

`void`

***

<a id="addOutputField"></a>

### addOutputField()

> **addOutputField**(`field`): `void`

Defined in: [src/ax/dsp/sig.ts:120](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspsigtsl120)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `field` | `Readonly`\<[`AxField`](#apidocs/interfaceaxfield)\> |

#### Returns

`void`

***

<a id="getDescription"></a>

### getDescription()

> **getDescription**(): `undefined` \| `string`

Defined in: [src/ax/dsp/sig.ts:137](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspsigtsl137)

#### Returns

`undefined` \| `string`

***

<a id="getInputFields"></a>

### getInputFields()

> **getInputFields**(): readonly [`AxIField`](#apidocs/typealiasaxifield)[]

Defined in: [src/ax/dsp/sig.ts:135](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspsigtsl135)

#### Returns

readonly [`AxIField`](#apidocs/typealiasaxifield)[]

***

<a id="getOutputFields"></a>

### getOutputFields()

> **getOutputFields**(): readonly [`AxIField`](#apidocs/typealiasaxifield)[]

Defined in: [src/ax/dsp/sig.ts:136](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspsigtsl136)

#### Returns

readonly [`AxIField`](#apidocs/typealiasaxifield)[]

***

<a id="hash"></a>

### hash()

> **hash**(): `string`

Defined in: [src/ax/dsp/sig.ts:207](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspsigtsl207)

#### Returns

`string`

***

<a id="setDescription"></a>

### setDescription()

> **setDescription**(`desc`): `void`

Defined in: [src/ax/dsp/sig.ts:110](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspsigtsl110)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `desc` | `string` |

#### Returns

`void`

***

<a id="setInputFields"></a>

### setInputFields()

> **setInputFields**(`fields`): `void`

Defined in: [src/ax/dsp/sig.ts:125](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspsigtsl125)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `fields` | readonly [`AxField`](#apidocs/interfaceaxfield)[] |

#### Returns

`void`

***

<a id="setOutputFields"></a>

### setOutputFields()

> **setOutputFields**(`fields`): `void`

Defined in: [src/ax/dsp/sig.ts:130](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspsigtsl130)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `fields` | readonly [`AxField`](#apidocs/interfaceaxfield)[] |

#### Returns

`void`

***

<a id="toJSONSchema"></a>

### toJSONSchema()

> **toJSONSchema**(): [`AxFunctionJSONSchema`](#apidocs/typealiasaxfunctionjsonschema)

Defined in: [src/ax/dsp/sig.ts:145](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspsigtsl145)

#### Returns

[`AxFunctionJSONSchema`](#apidocs/typealiasaxfunctionjsonschema)

***

<a id="toString"></a>

### toString()

> **toString**(): `string`

Defined in: [src/ax/dsp/sig.ts:209](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspsigtsl209)

#### Returns

`string`
