---
title: AxRateLimiterTokenUsage
---

Defined in: [src/ax/util/rate-limit.ts:9](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxutilrate-limittsl9)

## Constructors

<a id="Constructors"></a>

### new AxRateLimiterTokenUsage()

> **new AxRateLimiterTokenUsage**(`maxTokens`, `refillRate`, `options`?): [`AxRateLimiterTokenUsage`](#apidocs/classaxratelimitertokenusage)

Defined in: [src/ax/util/rate-limit.ts:16](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxutilrate-limittsl16)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `maxTokens` | `number` |
| `refillRate` | `number` |
| `options`? | `Readonly`\<[`AxRateLimiterTokenUsageOptions`](#apidocs/interfaceaxratelimitertokenusageoptions)\> |

#### Returns

[`AxRateLimiterTokenUsage`](#apidocs/classaxratelimitertokenusage)

## Methods

<a id="acquire"></a>

### acquire()

> **acquire**(`tokens`): `Promise`\<`void`\>

Defined in: [src/ax/util/rate-limit.ts:56](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxutilrate-limittsl56)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `tokens` | `number` |

#### Returns

`Promise`\<`void`\>
