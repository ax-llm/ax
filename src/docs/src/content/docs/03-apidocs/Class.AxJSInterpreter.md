---
title: AxJSInterpreter
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/funcs/code.ts#L29

## Constructors

<a id="constructors"></a>

### new AxJSInterpreter()

```ts
new AxJSInterpreter(__namedParameters: 
  | undefined
  | Readonly<{
  permissions: readonly AxJSInterpreterPermission[];
 }>): AxJSInterpreter
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/funcs/code.ts#L32

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `__namedParameters` | \| `undefined` \| `Readonly`\<\{ `permissions`: readonly [`AxJSInterpreterPermission`](/api/#03-apidocs/enumerationaxjsinterpreterpermission)[]; \}\> |

#### Returns

[`AxJSInterpreter`](/api/#03-apidocs/classaxjsinterpreter)

## Methods

<a id="toFunction"></a>

### toFunction()

```ts
toFunction(): AxFunction
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/funcs/code.ts#L67

#### Returns

[`AxFunction`](/api/#03-apidocs/typealiasaxfunction)
