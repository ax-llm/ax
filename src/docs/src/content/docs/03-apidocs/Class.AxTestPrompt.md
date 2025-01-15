---
title: AxTestPrompt
---

Defined in: [src/ax/dsp/evaluate.ts:13](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspevaluatetsl13)

## Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `IN` *extends* [`AxGenIn`](#apidocs/typealiasaxgenin) | [`AxGenIn`](#apidocs/typealiasaxgenin) |
| `OUT` *extends* [`AxGenOut`](#apidocs/typealiasaxgenout) | [`AxGenOut`](#apidocs/typealiasaxgenout) |

## Constructors

<a id="Constructors"></a>

### new AxTestPrompt()

> **new AxTestPrompt**\<`IN`, `OUT`\>(`__namedParameters`): [`AxTestPrompt`](#apidocs/classaxtestprompt)\<`IN`, `OUT`\>

Defined in: [src/ax/dsp/evaluate.ts:21](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspevaluatetsl21)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `__namedParameters` | `Readonly`\<[`AxEvaluateArgs`](#apidocs/typealiasaxevaluateargs)\<`IN`, `OUT`\>\> |

#### Returns

[`AxTestPrompt`](#apidocs/classaxtestprompt)\<`IN`, `OUT`\>

## Methods

<a id="run"></a>

### run()

> **run**(`metricFn`): `Promise`\<`void`\>

Defined in: [src/ax/dsp/evaluate.ts:34](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspevaluatetsl34)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `metricFn` | [`AxMetricFn`](#apidocs/typealiasaxmetricfn) |

#### Returns

`Promise`\<`void`\>
