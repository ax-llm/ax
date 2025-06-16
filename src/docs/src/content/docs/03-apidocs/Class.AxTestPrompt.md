---
title: AxTestPrompt
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/evaluate.ts#L14

## Type Parameters

| Type Parameter | Default type |
| :------ | :------ |
| `IN` *extends* [`AxGenIn`](/api/#03-apidocs/typealiasaxgenin) | [`AxGenIn`](/api/#03-apidocs/typealiasaxgenin) |
| `OUT` *extends* [`AxGenOut`](/api/#03-apidocs/typealiasaxgenout) | [`AxGenOut`](/api/#03-apidocs/typealiasaxgenout) |

## Constructors

<a id="constructors"></a>

### new AxTestPrompt()

```ts
new AxTestPrompt<IN, OUT>(__namedParameters: Readonly<AxEvaluateArgs<IN, OUT>>): AxTestPrompt<IN, OUT>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/evaluate.ts#L22

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `__namedParameters` | `Readonly`\<[`AxEvaluateArgs`](/api/#03-apidocs/typealiasaxevaluateargs)\<`IN`, `OUT`\>\> |

#### Returns

[`AxTestPrompt`](/api/#03-apidocs/classaxtestprompt)\<`IN`, `OUT`\>

## Methods

<a id="run"></a>

### run()

```ts
run(metricFn: AxMetricFn): Promise<void>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/evaluate.ts#L35

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `metricFn` | [`AxMetricFn`](/api/#03-apidocs/typealiasaxmetricfn) |

#### Returns

`Promise`\<`void`\>
