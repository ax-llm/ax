---
title: AxEmbeddingAdapter
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/funcs/embed.ts#L7

## Constructors

<a id="constructors"></a>

### new AxEmbeddingAdapter()

```ts
new AxEmbeddingAdapter(__namedParameters: Readonly<{
  ai: AxAIService;
  func: (args: readonly number[], extra?: Readonly<AxAIServiceActionOptions>) => Promise<unknown>;
  info: Readonly<{
     argumentDescription: string;
     description: string;
     name: string;
    }>;
 }>): AxEmbeddingAdapter
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/funcs/embed.ts#L19

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `__namedParameters` | `Readonly`\<\{ `ai`: [`AxAIService`](/api/#03-apidocs/interfaceaxaiservice); `func`: (`args`: readonly `number`[], `extra`?: `Readonly`\<[`AxAIServiceActionOptions`](/api/#03-apidocs/typealiasaxaiserviceactionoptions)\>) => `Promise`\<`unknown`\>; `info`: `Readonly`\<\{ `argumentDescription`: `string`; `description`: `string`; `name`: `string`; \}\>; \}\> |

#### Returns

[`AxEmbeddingAdapter`](/api/#03-apidocs/classaxembeddingadapter)

## Methods

<a id="toFunction"></a>

### toFunction()

```ts
toFunction(): AxFunction
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/funcs/embed.ts#L60

#### Returns

[`AxFunction`](/api/#03-apidocs/typealiasaxfunction)
