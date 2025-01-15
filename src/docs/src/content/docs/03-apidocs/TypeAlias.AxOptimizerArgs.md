---
title: AxOptimizerArgs
---

> **AxOptimizerArgs**\<`IN`, `OUT`\>: `object`

Defined in: [src/ax/dsp/optimize.ts:21](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspoptimizetsl21)

## Type Parameters

| Type Parameter |
| ------ |
| `IN` *extends* [`AxGenIn`](#apidocs/typealiasaxgenin) |
| `OUT` *extends* [`AxGenOut`](#apidocs/typealiasaxgenout) |

## Type declaration

<a id="ai"></a>

### ai

> **ai**: [`AxAIService`](#apidocs/interfaceaxaiservice)

<a id="examples"></a>

### examples

> **examples**: `Readonly`\<[`AxExample`](#apidocs/typealiasaxexample)[]\>

### options?

> \{ `maxDemos`: `number`; `maxExamples`: `number`; `maxRounds`: `number`; \}

<a id="program"></a>

### program

> **program**: `Readonly`\<[`AxProgram`](#apidocs/classaxprogram)\<`IN`, `OUT`\>\>
