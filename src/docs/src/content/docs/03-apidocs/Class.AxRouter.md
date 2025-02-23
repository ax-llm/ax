---
title: AxRouter
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/router.ts#L29

## Constructors

<a id="constructors"></a>

### new AxRouter()

> **new AxRouter**(`ai`): [`AxRouter`](/api/#03-apidocs/classaxrouter)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/router.ts#L35

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ai` | [`AxAIService`](/api/#03-apidocs/interfaceaxaiservice) |

#### Returns

[`AxRouter`](/api/#03-apidocs/classaxrouter)

## Methods

<a id="forward"></a>

### forward()

> **forward**(`text`, `options`?): `Promise`\<`string`\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/router.ts#L59

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `text` | `string` |
| `options`? | `Readonly`\<[`AxRouterForwardOptions`](/api/#03-apidocs/interfaceaxrouterforwardoptions)\> |

#### Returns

`Promise`\<`string`\>

***

<a id="getState"></a>

### getState()

> **getState**(): `undefined` \| [`AxDBState`](/api/#03-apidocs/typealiasaxdbstate)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/router.ts#L40

#### Returns

`undefined` \| [`AxDBState`](/api/#03-apidocs/typealiasaxdbstate)

***

<a id="setOptions"></a>

### setOptions()

> **setOptions**(`options`): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/router.ts#L94

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

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/router.ts#L48

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `routes` | readonly [`AxRoute`](/api/#03-apidocs/classaxroute)[] |

#### Returns

`Promise`\<`void`\>

***

<a id="setState"></a>

### setState()

> **setState**(`state`): `void`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/router.ts#L44

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `state` | [`AxDBState`](/api/#03-apidocs/typealiasaxdbstate) |

#### Returns

`void`
