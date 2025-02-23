---
title: AxSignature
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/sig.ts#L37

## Constructors

<a id="constructors"></a>

### new AxSignature()

> **new AxSignature**(`signature`?): [`AxSignature`](/api/#03-apidocs/classaxsignature)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/sig.ts#L45

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `signature`? | `Readonly`\<`string` \| [`AxSignature`](/api/#03-apidocs/classaxsignature)\> |

#### Returns

[`AxSignature`](/api/#03-apidocs/classaxsignature)

## Methods

<a id="addInputField"></a>

### addInputField()

> **addInputField**(`field`): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/sig.ts#L118

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `field` | `Readonly`\<[`AxField`](/api/#03-apidocs/interfaceaxfield)\> |

#### Returns

`void`

***

<a id="addOutputField"></a>

### addOutputField()

> **addOutputField**(`field`): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/sig.ts#L123

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `field` | `Readonly`\<[`AxField`](/api/#03-apidocs/interfaceaxfield)\> |

#### Returns

`void`

***

<a id="getDescription"></a>

### getDescription()

> **getDescription**(): `undefined` \| `string`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/sig.ts#L140

#### Returns

`undefined` \| `string`

***

<a id="getInputFields"></a>

### getInputFields()

> **getInputFields**(): readonly [`AxIField`](/api/#03-apidocs/typealiasaxifield)[]

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/sig.ts#L138

#### Returns

readonly [`AxIField`](/api/#03-apidocs/typealiasaxifield)[]

***

<a id="getOutputFields"></a>

### getOutputFields()

> **getOutputFields**(): readonly [`AxIField`](/api/#03-apidocs/typealiasaxifield)[]

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/sig.ts#L139

#### Returns

readonly [`AxIField`](/api/#03-apidocs/typealiasaxifield)[]

***

<a id="hash"></a>

### hash()

> **hash**(): `string`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/sig.ts#L210

#### Returns

`string`

***

<a id="setDescription"></a>

### setDescription()

> **setDescription**(`desc`): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/sig.ts#L113

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

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/sig.ts#L128

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `fields` | readonly [`AxField`](/api/#03-apidocs/interfaceaxfield)[] |

#### Returns

`void`

***

<a id="setOutputFields"></a>

### setOutputFields()

> **setOutputFields**(`fields`): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/sig.ts#L133

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `fields` | readonly [`AxField`](/api/#03-apidocs/interfaceaxfield)[] |

#### Returns

`void`

***

<a id="toJSONSchema"></a>

### toJSONSchema()

> **toJSONSchema**(): [`AxFunctionJSONSchema`](/api/#03-apidocs/typealiasaxfunctionjsonschema)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/sig.ts#L148

#### Returns

[`AxFunctionJSONSchema`](/api/#03-apidocs/typealiasaxfunctionjsonschema)

***

<a id="toString"></a>

### toString()

> **toString**(): `string`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/sig.ts#L212

#### Returns

`string`
