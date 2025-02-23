---
title: AxTestPrompt
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/evaluate.ts#L13

## Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `IN` *extends* [`AxGenIn`](/api/#03-apidocs/typealiasaxgenin) | [`AxGenIn`](/api/#03-apidocs/typealiasaxgenin) |
| `OUT` *extends* [`AxGenOut`](/api/#03-apidocs/typealiasaxgenout) | [`AxGenOut`](/api/#03-apidocs/typealiasaxgenout) |

## Constructors

<a id="constructors"></a>

### new AxTestPrompt()

> **new AxTestPrompt**\<`IN`, `OUT`\>(`__namedParameters`): [`AxTestPrompt`](/api/#03-apidocs/classaxtestprompt)\<`IN`, `OUT`\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/evaluate.ts#L21

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `__namedParameters` | `Readonly`\<[`AxEvaluateArgs`](/api/#03-apidocs/typealiasaxevaluateargs)\<`IN`, `OUT`\>\> |

#### Returns

[`AxTestPrompt`](/api/#03-apidocs/classaxtestprompt)\<`IN`, `OUT`\>

## Methods

<a id="run"></a>

### run()

> **run**(`metricFn`): `Promise`\<`void`\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/evaluate.ts#L34

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `metricFn` | [`AxMetricFn`](/api/#03-apidocs/typealiasaxmetricfn) |

#### Returns

`Promise`\<`void`\>
