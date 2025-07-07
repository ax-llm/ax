---
title: AxFunctionProcessor
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/functions.ts#L106

## Constructors

<a id="constructors"></a>

### new AxFunctionProcessor()

```ts
new AxFunctionProcessor(funcList: readonly AxFunction[]): AxFunctionProcessor
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/functions.ts#L109

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `funcList` | readonly [`AxFunction`](/api/#03-apidocs/typealiasaxfunction)[] |

#### Returns

[`AxFunctionProcessor`](/api/#03-apidocs/classaxfunctionprocessor)

## Methods

<a id="execute"></a>

### execute()

```ts
execute(func: Readonly<AxChatResponseFunctionCall>, options?: Readonly<AxAIServiceActionOptions>): Promise<string>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/functions.ts#L149

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `func` | `Readonly`\<[`AxChatResponseFunctionCall`](/api/#03-apidocs/typealiasaxchatresponsefunctioncall)\> |
| `options`? | `Readonly`\<[`AxAIServiceActionOptions`](/api/#03-apidocs/typealiasaxaiserviceactionoptions)\> |

#### Returns

`Promise`\<`string`\>
