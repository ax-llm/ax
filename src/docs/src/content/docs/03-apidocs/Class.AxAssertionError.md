---
title: AxAssertionError
---

Defined in: [src/ax/dsp/asserts.ts:17](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspassertstsl17)

## Extends

- `Error`

## Constructors

<a id="Constructors"></a>

### new AxAssertionError()

> **new AxAssertionError**(`__namedParameters`): [`AxAssertionError`](#apidocs/classaxassertionerror)

Defined in: [src/ax/dsp/asserts.ts:21](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspassertstsl21)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `__namedParameters` | `Readonly`\<\{ `message`: `string`; `optional`: `boolean`; `values`: `Record`\<`string`, `unknown`\>; \}\> |

#### Returns

[`AxAssertionError`](#apidocs/classaxassertionerror)

#### Overrides

`Error.constructor`

## Properties

<a id="cause"></a>

### cause?

> `optional` **cause**: `unknown`

Defined in: node\_modules/typescript/lib/lib.es2022.error.d.ts:26

#### Inherited from

`Error.cause`

***

<a id="message"></a>

### message

> **message**: `string`

Defined in: node\_modules/typescript/lib/lib.es5.d.ts:1077

#### Inherited from

`Error.message`

***

<a id="name"></a>

### name

> **name**: `string`

Defined in: node\_modules/typescript/lib/lib.es5.d.ts:1076

#### Inherited from

`Error.name`

***

<a id="stack"></a>

### stack?

> `optional` **stack**: `string`

Defined in: node\_modules/typescript/lib/lib.es5.d.ts:1078

#### Inherited from

`Error.stack`

***

<a id="prepareStackTrace"></a>

### prepareStackTrace()?

> `static` `optional` **prepareStackTrace**: (`err`, `stackTraces`) => `any`

Defined in: node\_modules/@types/node/globals.d.ts:143

Optional override for formatting stack traces

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `err` | `Error` |
| `stackTraces` | `CallSite`[] |

#### Returns

`any`

#### See

https://v8.dev/docs/stack-trace-api#customizing-stack-traces

#### Inherited from

`Error.prepareStackTrace`

***

<a id="stackTraceLimit"></a>

### stackTraceLimit

> `static` **stackTraceLimit**: `number`

Defined in: node\_modules/@types/node/globals.d.ts:145

#### Inherited from

`Error.stackTraceLimit`

## Methods

<a id="getFixingInstructions"></a>

### getFixingInstructions()

> **getFixingInstructions**(`_sig`): `object`[]

Defined in: [src/ax/dsp/asserts.ts:40](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspassertstsl40)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `_sig` | `Readonly`\<[`AxSignature`](#apidocs/classaxsignature)\> |

#### Returns

`object`[]

***

<a id="getOptional"></a>

### getOptional()

> **getOptional**(): `undefined` \| `boolean`

Defined in: [src/ax/dsp/asserts.ts:37](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspassertstsl37)

#### Returns

`undefined` \| `boolean`

***

<a id="getValue"></a>

### getValue()

> **getValue**(): `Record`\<`string`, `unknown`\>

Defined in: [src/ax/dsp/asserts.ts:36](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspassertstsl36)

#### Returns

`Record`\<`string`, `unknown`\>

***

<a id="captureStackTrace"></a>

### captureStackTrace()

> `static` **captureStackTrace**(`targetObject`, `constructorOpt`?): `void`

Defined in: node\_modules/@types/node/globals.d.ts:136

Create .stack property on a target object

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `targetObject` | `object` |
| `constructorOpt`? | `Function` |

#### Returns

`void`

#### Inherited from

`Error.captureStackTrace`
