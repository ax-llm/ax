---
title: AxFunctionProcessor
---

Defined in: [src/ax/dsp/functions.ts:24](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspfunctionstsl24)

## Constructors

<a id="Constructors"></a>

### new AxFunctionProcessor()

> **new AxFunctionProcessor**(`funcList`): [`AxFunctionProcessor`](#apidocs/classaxfunctionprocessor)

Defined in: [src/ax/dsp/functions.ts:27](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspfunctionstsl27)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `funcList` | readonly [`AxFunction`](#apidocs/typealiasaxfunction)[] |

#### Returns

[`AxFunctionProcessor`](#apidocs/classaxfunctionprocessor)

## Methods

<a id="execute"></a>

### execute()

> **execute**(`func`, `options`?): `Promise`\<[`AxFunctionExec`](#apidocs/typealiasaxfunctionexec)\>

Defined in: [src/ax/dsp/functions.ts:73](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdspfunctionstsl73)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `func` | `Readonly`\<[`AxChatResponseFunctionCall`](#apidocs/typealiasaxchatresponsefunctioncall)\> |
| `options`? | `Readonly`\<[`AxAIServiceActionOptions`](#apidocs/typealiasaxaiserviceactionoptions)\> |

#### Returns

`Promise`\<[`AxFunctionExec`](#apidocs/typealiasaxfunctionexec)\>
