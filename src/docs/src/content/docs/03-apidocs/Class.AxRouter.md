---
title: AxRouter
---

Defined in: [src/ax/dsp/router.ts:29](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdsproutertsl29)

## Constructors

<a id="Constructors"></a>

### new AxRouter()

> **new AxRouter**(`ai`): [`AxRouter`](#apidocs/classaxrouter)

Defined in: [src/ax/dsp/router.ts:35](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdsproutertsl35)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ai` | [`AxAIService`](#apidocs/interfaceaxaiservice) |

#### Returns

[`AxRouter`](#apidocs/classaxrouter)

## Methods

<a id="forward"></a>

### forward()

> **forward**(`text`, `options`?): `Promise`\<`string`\>

Defined in: [src/ax/dsp/router.ts:59](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdsproutertsl59)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `text` | `string` |
| `options`? | `Readonly`\<[`AxRouterForwardOptions`](#apidocs/interfaceaxrouterforwardoptions)\> |

#### Returns

`Promise`\<`string`\>

***

<a id="getState"></a>

### getState()

> **getState**(): `undefined` \| [`AxDBState`](#apidocs/typealiasaxdbstate)

Defined in: [src/ax/dsp/router.ts:40](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdsproutertsl40)

#### Returns

`undefined` \| [`AxDBState`](#apidocs/typealiasaxdbstate)

***

<a id="setOptions"></a>

### setOptions()

> **setOptions**(`options`): `void`

Defined in: [src/ax/dsp/router.ts:94](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdsproutertsl94)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | `Readonly`\<\{ `debug`: `boolean`; \}\> |

#### Returns

`void`

***

<a id="setRoutes"></a>

### setRoutes()

> **setRoutes**(`routes`): `Promise`\<`void`\>

Defined in: [src/ax/dsp/router.ts:48](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdsproutertsl48)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `routes` | readonly [`AxRoute`](#apidocs/classaxroute)[] |

#### Returns

`Promise`\<`void`\>

***

<a id="setState"></a>

### setState()

> **setState**(`state`): `void`

Defined in: [src/ax/dsp/router.ts:44](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxdsproutertsl44)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `state` | [`AxDBState`](#apidocs/typealiasaxdbstate) |

#### Returns

`void`
