---
title: AxBootstrapFewShot
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/optimize.ts#L28

## Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `IN` *extends* [`AxGenIn`](/api/#03-apidocs/typealiasaxgenin) | [`AxGenIn`](/api/#03-apidocs/typealiasaxgenin) |
| `OUT` *extends* [`AxGenOut`](/api/#03-apidocs/typealiasaxgenout) | [`AxGenOut`](/api/#03-apidocs/typealiasaxgenout) |

## Constructors

<a id="constructors"></a>

### new AxBootstrapFewShot()

> **new AxBootstrapFewShot**\<`IN`, `OUT`\>(`__namedParameters`): [`AxBootstrapFewShot`](/api/#03-apidocs/classaxbootstrapfewshot)\<`IN`, `OUT`\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/optimize.ts#L40

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `__namedParameters` | `Readonly`\<[`AxOptimizerArgs`](/api/#03-apidocs/typealiasaxoptimizerargs)\<`IN`, `OUT`\>\> |

#### Returns

[`AxBootstrapFewShot`](/api/#03-apidocs/classaxbootstrapfewshot)\<`IN`, `OUT`\>

## Methods

<a id="compile"></a>

### compile()

> **compile**(`metricFn`, `options`?): `Promise`\<[`AxProgramDemos`](/api/#03-apidocs/typealiasaxprogramdemos)[]\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/optimize.ts#L105

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `metricFn` | [`AxMetricFn`](/api/#03-apidocs/typealiasaxmetricfn) |
| `options`? | `Readonly`\<`undefined` \| \{ `maxDemos`: `number`; `maxExamples`: `number`; `maxRounds`: `number`; \}\> |

#### Returns

`Promise`\<[`AxProgramDemos`](/api/#03-apidocs/typealiasaxprogramdemos)[]\>
