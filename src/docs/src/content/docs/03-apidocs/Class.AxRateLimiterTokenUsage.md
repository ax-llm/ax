---
title: AxRateLimiterTokenUsage
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/util/rate-limit.ts#L9

## Constructors

<a id="constructors"></a>

### new AxRateLimiterTokenUsage()

```ts
new AxRateLimiterTokenUsage(
   maxTokens: number, 
   refillRate: number, 
   options?: Readonly<AxRateLimiterTokenUsageOptions>): AxRateLimiterTokenUsage
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/util/rate-limit.ts#L16

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `maxTokens` | `number` |
| `refillRate` | `number` |
| `options`? | `Readonly`\<[`AxRateLimiterTokenUsageOptions`](/api/#03-apidocs/interfaceaxratelimitertokenusageoptions)\> |

#### Returns

[`AxRateLimiterTokenUsage`](/api/#03-apidocs/classaxratelimitertokenusage)

## Methods

<a id="acquire"></a>

### acquire()

```ts
acquire(tokens: number): Promise<void>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/util/rate-limit.ts#L56

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `tokens` | `number` |

#### Returns

`Promise`\<`void`\>
