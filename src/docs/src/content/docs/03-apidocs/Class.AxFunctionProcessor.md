---
title: AxFunctionProcessor
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/functions.ts#L73

## Constructors

<a id="constructors"></a>

### new AxFunctionProcessor()

> **new AxFunctionProcessor**(`funcList`): [`AxFunctionProcessor`](/api/#03-apidocs/classaxfunctionprocessor)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/functions.ts#L76

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `funcList` | readonly [`AxFunction`](/api/#03-apidocs/typealiasaxfunction)[] |

#### Returns

[`AxFunctionProcessor`](/api/#03-apidocs/classaxfunctionprocessor)

## Methods

<a id="execute"></a>

### execute()

> **execute**(`func`, `options`?): `Promise`\<`string`\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/functions.ts#L116

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `func` | `Readonly`\<[`AxChatResponseFunctionCall`](/api/#03-apidocs/typealiasaxchatresponsefunctioncall)\> |
| `options`? | `Readonly`\<[`AxAIServiceActionOptions`](/api/#03-apidocs/typealiasaxaiserviceactionoptions)\> |

#### Returns

`Promise`\<`string`\>
