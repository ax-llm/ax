---
title: AxRateLimiterTokenUsage
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/util/rate-limit.ts#L9

## Constructors

<a id="constructors"></a>

### new AxRateLimiterTokenUsage()

> **new AxRateLimiterTokenUsage**(`maxTokens`, `refillRate`, `options`?): [`AxRateLimiterTokenUsage`](/api/#03-apidocs/classaxratelimitertokenusage)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/util/rate-limit.ts#L16

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `maxTokens` | `number` |
| `refillRate` | `number` |
| `options`? | `Readonly`\<[`AxRateLimiterTokenUsageOptions`](/api/#03-apidocs/interfaceaxratelimitertokenusageoptions)\> |

#### Returns

[`AxRateLimiterTokenUsage`](/api/#03-apidocs/classaxratelimitertokenusage)

## Methods

<a id="acquire"></a>

### acquire()

> **acquire**(`tokens`): `Promise`\<`void`\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/util/rate-limit.ts#L56

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `tokens` | `number` |

#### Returns

`Promise`\<`void`\>
