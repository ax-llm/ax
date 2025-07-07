---
title: AxInstanceRegistry
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/registry.ts#L1

## Type Parameters

| Type Parameter |
| :------ |
| `T` |

## Constructors

<a id="constructors"></a>

### new AxInstanceRegistry()

```ts
new AxInstanceRegistry<T>(): AxInstanceRegistry<T>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/registry.ts#L4

#### Returns

[`AxInstanceRegistry`](/api/#03-apidocs/classaxinstanceregistry)\<`T`\>

## Methods

<a id="iterator"></a>

### \[iterator\]()

```ts
iterator: Generator<T, void, unknown>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/registry.ts#L12

#### Returns

`Generator`\<`T`, `void`, `unknown`\>

***

<a id="register"></a>

### register()

```ts
register(instance: T): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/registry.ts#L8

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `instance` | `T` |

#### Returns

`void`
