---
title: AxSignature
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/sig.ts#L37

## Constructors

<a id="constructors"></a>

### new AxSignature()

```ts
new AxSignature(signature?: Readonly<string | AxSignature>): AxSignature
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/sig.ts#L45

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `signature`? | `Readonly`\<`string` \| [`AxSignature`](/api/#03-apidocs/classaxsignature)\> |

#### Returns

[`AxSignature`](/api/#03-apidocs/classaxsignature)

## Methods

<a id="addInputField"></a>

### addInputField()

```ts
addInputField(field: Readonly<AxField>): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/sig.ts#L118

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `field` | `Readonly`\<[`AxField`](/api/#03-apidocs/interfaceaxfield)\> |

#### Returns

`void`

***

<a id="addOutputField"></a>

### addOutputField()

```ts
addOutputField(field: Readonly<AxField>): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/sig.ts#L123

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `field` | `Readonly`\<[`AxField`](/api/#03-apidocs/interfaceaxfield)\> |

#### Returns

`void`

***

<a id="getDescription"></a>

### getDescription()

```ts
getDescription(): undefined | string
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/sig.ts#L140

#### Returns

`undefined` \| `string`

***

<a id="getInputFields"></a>

### getInputFields()

```ts
getInputFields(): readonly AxIField[]
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/sig.ts#L138

#### Returns

readonly [`AxIField`](/api/#03-apidocs/typealiasaxifield)[]

***

<a id="getOutputFields"></a>

### getOutputFields()

```ts
getOutputFields(): readonly AxIField[]
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/sig.ts#L139

#### Returns

readonly [`AxIField`](/api/#03-apidocs/typealiasaxifield)[]

***

<a id="hash"></a>

### hash()

```ts
hash(): string
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/sig.ts#L210

#### Returns

`string`

***

<a id="setDescription"></a>

### setDescription()

```ts
setDescription(desc: string): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/sig.ts#L113

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `desc` | `string` |

#### Returns

`void`

***

<a id="setInputFields"></a>

### setInputFields()

```ts
setInputFields(fields: readonly AxField[]): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/sig.ts#L128

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `fields` | readonly [`AxField`](/api/#03-apidocs/interfaceaxfield)[] |

#### Returns

`void`

***

<a id="setOutputFields"></a>

### setOutputFields()

```ts
setOutputFields(fields: readonly AxField[]): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/sig.ts#L133

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `fields` | readonly [`AxField`](/api/#03-apidocs/interfaceaxfield)[] |

#### Returns

`void`

***

<a id="toJSON"></a>

### toJSON()

```ts
toJSON(): object
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/sig.ts#L214

#### Returns

`object`

| Name | Type |
| :------ | :------ |
| <a id="description"></a> `description` | `undefined` \| `string` |
| <a id="id"></a> `id` | `string` |
| <a id="inputFields"></a> `inputFields` | [`AxIField`](/api/#03-apidocs/typealiasaxifield)[] |
| <a id="outputFields"></a> `outputFields` | [`AxIField`](/api/#03-apidocs/typealiasaxifield)[] |

***

<a id="toJSONSchema"></a>

### toJSONSchema()

```ts
toJSONSchema(): AxFunctionJSONSchema
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/sig.ts#L148

#### Returns

[`AxFunctionJSONSchema`](/api/#03-apidocs/typealiasaxfunctionjsonschema)

***

<a id="toString"></a>

### toString()

```ts
toString(): string
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/sig.ts#L212

#### Returns

`string`
