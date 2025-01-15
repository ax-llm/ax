---
title: AxValidationError
---

Defined in: [src/ax/dsp/validate.ts:4](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspvalidatetsl4)

## Extends

- `Error`

## Constructors

<a id="Constructors"></a>

### new AxValidationError()

> **new AxValidationError**(`__namedParameters`): [`AxValidationError`](#apidocs/classaxvalidationerror)

Defined in: [src/ax/dsp/validate.ts:8](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspvalidatetsl8)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `__namedParameters` | `Readonly`\<\{ `field`: [`AxField`](#apidocs/interfaceaxfield); `message`: `string`; `value`: `string`; \}\> |

#### Returns

[`AxValidationError`](#apidocs/classaxvalidationerror)

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

<a id="getField"></a>

### getField()

> **getField**(): [`AxField`](#apidocs/interfaceaxfield)

Defined in: [src/ax/dsp/validate.ts:24](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspvalidatetsl24)

#### Returns

[`AxField`](#apidocs/interfaceaxfield)

***

<a id="getFixingInstructions"></a>

### getFixingInstructions()

> **getFixingInstructions**(): `object`[]

Defined in: [src/ax/dsp/validate.ts:27](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspvalidatetsl27)

#### Returns

`object`[]

***

<a id="getValue"></a>

### getValue()

> **getValue**(): `string`

Defined in: [src/ax/dsp/validate.ts:25](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspvalidatetsl25)

#### Returns

`string`

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
