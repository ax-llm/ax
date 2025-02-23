---
title: AxOptimizerArgs
---

> **AxOptimizerArgs**\<`IN`, `OUT`\>: `object`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/optimize.ts#L21

## Type Parameters

| Type Parameter |
| ------ |
| `IN` *extends* [`AxGenIn`](/api/#03-apidocs/typealiasaxgenin) |
| `OUT` *extends* [`AxGenOut`](/api/#03-apidocs/typealiasaxgenout) |

## Type declaration

<a id="ai"></a>

### ai

> **ai**: [`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)

<a id="examples"></a>

### examples

> **examples**: `Readonly`\<[`AxExample`](/api/#03-apidocs/typealiasaxexample)[]\>

### options?

> \{ `maxDemos`: `number`; `maxExamples`: `number`; `maxRounds`: `number`; \}

<a id="program"></a>

### program

> **program**: `Readonly`\<[`AxProgram`](/api/#03-apidocs/classaxprogram)\<`IN`, `OUT`\>\>
