---
title: AxBootstrapFewShot
---

Defined in: [src/ax/dsp/optimize.ts:28](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspoptimizetsl28)

## Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `IN` *extends* [`AxGenIn`](#apidocs/typealiasaxgenin) | [`AxGenIn`](#apidocs/typealiasaxgenin) |
| `OUT` *extends* [`AxGenOut`](#apidocs/typealiasaxgenout) | [`AxGenOut`](#apidocs/typealiasaxgenout) |

## Constructors

<a id="Constructors"></a>

### new AxBootstrapFewShot()

> **new AxBootstrapFewShot**\<`IN`, `OUT`\>(`__namedParameters`): [`AxBootstrapFewShot`](#apidocs/classaxbootstrapfewshot)\<`IN`, `OUT`\>

Defined in: [src/ax/dsp/optimize.ts:40](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspoptimizetsl40)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `__namedParameters` | `Readonly`\<[`AxOptimizerArgs`](#apidocs/typealiasaxoptimizerargs)\<`IN`, `OUT`\>\> |

#### Returns

[`AxBootstrapFewShot`](#apidocs/classaxbootstrapfewshot)\<`IN`, `OUT`\>

## Methods

<a id="compile"></a>

### compile()

> **compile**(`metricFn`, `options`?): `Promise`\<[`AxProgramDemos`](#apidocs/typealiasaxprogramdemos)[]\>

Defined in: [src/ax/dsp/optimize.ts:105](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspoptimizetsl105)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `metricFn` | [`AxMetricFn`](#apidocs/typealiasaxmetricfn) |
| `options`? | `Readonly`\<`undefined` \| \{ `maxDemos`: `number`; `maxExamples`: `number`; `maxRounds`: `number`; \}\> |

#### Returns

`Promise`\<[`AxProgramDemos`](#apidocs/typealiasaxprogramdemos)[]\>
