---
title: AxOptimizerArgs
---

```ts
type AxOptimizerArgs<IN, OUT> = object;
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/optimize.ts#L22

## Type Parameters

| Type Parameter |
| :------ |
| `IN` *extends* [`AxGenIn`](/api/#03-apidocs/typealiasaxgenin) |
| `OUT` *extends* [`AxGenOut`](/api/#03-apidocs/typealiasaxgenout) |

## Type declaration

| Name | Type |
| :------ | :------ |
| <a id="ai"></a> `ai` | [`AxAIService`](/api/#03-apidocs/interfaceaxaiservice) |
| <a id="examples"></a> `examples` | `Readonly`\<[`AxExample`](/api/#03-apidocs/typealiasaxexample)[]\> |
| <a id="options"></a> `options`? | \{ `batchSize`: `number`; `costMonitoring`: `boolean`; `debugMode`: `boolean`; `earlyStoppingPatience`: `number`; `maxDemos`: `number`; `maxExamples`: `number`; `maxRounds`: `number`; `maxTokensPerGeneration`: `number`; `teacherAI`: [`AxAIService`](/api/#03-apidocs/interfaceaxaiservice); `verboseMode`: `boolean`; \} |
| <a id="program"></a> `program` | `Readonly`\<[`AxProgram`](/api/#03-apidocs/classaxprogram)\<`IN`, `OUT`\>\> |
