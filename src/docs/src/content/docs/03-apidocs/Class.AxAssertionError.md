---
title: AxAssertionError
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/asserts.ts#L16

## Extends

- `Error`

## Constructors

<a id="constructors"></a>

### new AxAssertionError()

```ts
new AxAssertionError(__namedParameters: Readonly<{
  message: string;
 }>): AxAssertionError
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/asserts.ts#L17

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `__namedParameters` | `Readonly`\<\{ `message`: `string`; \}\> |

#### Returns

[`AxAssertionError`](/api/#03-apidocs/classaxassertionerror)

#### Overrides

```ts
Error.constructor
```

## Properties

| Property | Modifier | Type | Description | Inherited from |
| :------ | :------ | :------ | :------ | :------ |
| <a id="cause"></a> `cause?` | `public` | `unknown` | - | `Error.cause` |
| <a id="message"></a> `message` | `public` | `string` | - | `Error.message` |
| <a id="name"></a> `name` | `public` | `string` | - | `Error.name` |
| <a id="stack"></a> `stack?` | `public` | `string` | - | `Error.stack` |
| <a id="prepareStackTrace"></a> `prepareStackTrace?` | `static` | (`err`: `Error`, `stackTraces`: `CallSite`[]) => `any` | Optional override for formatting stack traces **See** https://v8.dev/docs/stack-trace-api#customizing-stack-traces | `Error.prepareStackTrace` |
| <a id="stackTraceLimit"></a> `stackTraceLimit` | `static` | `number` | - | `Error.stackTraceLimit` |

## Methods

<a id="getFixingInstructions"></a>

### getFixingInstructions()

```ts
getFixingInstructions(): object[]
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/asserts.ts#L26

#### Returns

`object`[]

***

<a id="toString"></a>

### toString()

```ts
toString(): string
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/asserts.ts#L39

Returns a string representation of an object.

#### Returns

`string`

***

<a id="captureStackTrace"></a>

### captureStackTrace()

```ts
static captureStackTrace(targetObject: object, constructorOpt?: Function): void
```

Defined in: node\_modules/@types/node/globals.d.ts:136

Create .stack property on a target object

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `targetObject` | `object` |
| `constructorOpt`? | `Function` |

#### Returns

`void`

#### Inherited from

```ts
Error.captureStackTrace
```
