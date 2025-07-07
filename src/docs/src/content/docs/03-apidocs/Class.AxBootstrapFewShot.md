---
title: AxBootstrapFewShot
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/optimize.ts#L51

## Type Parameters

| Type Parameter | Default type |
| :------ | :------ |
| `IN` *extends* [`AxGenIn`](/api/#03-apidocs/typealiasaxgenin) | [`AxGenIn`](/api/#03-apidocs/typealiasaxgenin) |
| `OUT` *extends* [`AxGenOut`](/api/#03-apidocs/typealiasaxgenout) | [`AxGenOut`](/api/#03-apidocs/typealiasaxgenout) |

## Constructors

<a id="constructors"></a>

### new AxBootstrapFewShot()

```ts
new AxBootstrapFewShot<IN, OUT>(__namedParameters: Readonly<AxOptimizerArgs<IN, OUT>>): AxBootstrapFewShot<IN, OUT>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/optimize.ts#L76

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `__namedParameters` | `Readonly`\<[`AxOptimizerArgs`](/api/#03-apidocs/typealiasaxoptimizerargs)\<`IN`, `OUT`\>\> |

#### Returns

[`AxBootstrapFewShot`](/api/#03-apidocs/classaxbootstrapfewshot)\<`IN`, `OUT`\>

## Methods

<a id="compile"></a>

### compile()

```ts
compile(metricFn: AxMetricFn, options?: Readonly<
  | undefined
  | {
  batchSize: number;
  costMonitoring: boolean;
  debugMode: boolean;
  earlyStoppingPatience: number;
  maxDemos: number;
  maxExamples: number;
  maxRounds: number;
  maxTokensPerGeneration: number;
  teacherAI: AxAIService<unknown, unknown>;
  verboseMode: boolean;
 }>): Promise<{
  demos: AxProgramDemos[];
  stats: AxOptimizationStats;
}>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/optimize.ts#L244

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `metricFn` | [`AxMetricFn`](/api/#03-apidocs/typealiasaxmetricfn) |
| `options`? | `Readonly`\< \| `undefined` \| \{ `batchSize`: `number`; `costMonitoring`: `boolean`; `debugMode`: `boolean`; `earlyStoppingPatience`: `number`; `maxDemos`: `number`; `maxExamples`: `number`; `maxRounds`: `number`; `maxTokensPerGeneration`: `number`; `teacherAI`: [`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)\<`unknown`, `unknown`\>; `verboseMode`: `boolean`; \}\> |

#### Returns

`Promise`\<\{
  `demos`: [`AxProgramDemos`](/api/#03-apidocs/typealiasaxprogramdemos)[];
  `stats`: [`AxOptimizationStats`](/api/#03-apidocs/interfaceaxoptimizationstats);
 \}\>

***

<a id="getStats"></a>

### getStats()

```ts
getStats(): AxOptimizationStats
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/optimize.ts#L281

#### Returns

[`AxOptimizationStats`](/api/#03-apidocs/interfaceaxoptimizationstats)
