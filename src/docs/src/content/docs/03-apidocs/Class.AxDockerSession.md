---
title: AxDockerSession
---

Defined in: [src/ax/funcs/docker.ts:56](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxfuncsdockertsl56)

## Constructors

<a id="Constructors"></a>

### new AxDockerSession()

> **new AxDockerSession**(`apiUrl`): [`AxDockerSession`](#apidocs/classaxdockersession)

Defined in: [src/ax/funcs/docker.ts:60](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxfuncsdockertsl60)

#### Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `apiUrl` | `string` | `'http://localhost:2375'` |

#### Returns

[`AxDockerSession`](#apidocs/classaxdockersession)

## Methods

<a id="connectToContainer"></a>

### connectToContainer()

> **connectToContainer**(`containerId`): `Promise`\<`void`\>

Defined in: [src/ax/funcs/docker.ts:186](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxfuncsdockertsl186)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `containerId` | `string` |

#### Returns

`Promise`\<`void`\>

***

<a id="createContainer"></a>

### createContainer()

> **createContainer**(`__namedParameters`): `Promise`\<\{ `Id`: `string`; \}\>

Defined in: [src/ax/funcs/docker.ts:80](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxfuncsdockertsl80)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `__namedParameters` | `Readonly`\<\{ `doNotPullImage`: `boolean`; `imageName`: `string`; `tag`: `string`; `volumes`: `object`[]; \}\> |

#### Returns

`Promise`\<\{ `Id`: `string`; \}\>

***

<a id="executeCommand"></a>

### executeCommand()

> **executeCommand**(`command`): `Promise`\<`string`\>

Defined in: [src/ax/funcs/docker.ts:274](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxfuncsdockertsl274)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `command` | `string` |

#### Returns

`Promise`\<`string`\>

***

<a id="findOrCreateContainer"></a>

### findOrCreateContainer()

> **findOrCreateContainer**(`__namedParameters`): `Promise`\<\{ `Id`: `string`; `isNew`: `boolean`; \}\>

Defined in: [src/ax/funcs/docker.ts:128](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxfuncsdockertsl128)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `__namedParameters` | `Readonly`\<\{ `doNotPullImage`: `boolean`; `imageName`: `string`; `tag`: `string`; `volumes`: `object`[]; \}\> |

#### Returns

`Promise`\<\{ `Id`: `string`; `isNew`: `boolean`; \}\>

***

<a id="getContainerLogs"></a>

### getContainerLogs()

> **getContainerLogs**(): `Promise`\<`string`\>

Defined in: [src/ax/funcs/docker.ts:263](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxfuncsdockertsl263)

#### Returns

`Promise`\<`string`\>

***

<a id="listContainers"></a>

### listContainers()

> **listContainers**(`all`): `Promise`\<[`AxDockerContainer`](#apidocs/interfaceaxdockercontainer)[]\>

Defined in: [src/ax/funcs/docker.ts:256](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxfuncsdockertsl256)

#### Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `all` | `boolean` | `false` |

#### Returns

`Promise`\<[`AxDockerContainer`](#apidocs/interfaceaxdockercontainer)[]\>

***

<a id="pullImage"></a>

### pullImage()

> **pullImage**(`imageName`): `Promise`\<`void`\>

Defined in: [src/ax/funcs/docker.ts:64](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxfuncsdockertsl64)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `imageName` | `string` |

#### Returns

`Promise`\<`void`\>

***

<a id="startContainer"></a>

### startContainer()

> **startContainer**(): `Promise`\<`void`\>

Defined in: [src/ax/funcs/docker.ts:169](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxfuncsdockertsl169)

#### Returns

`Promise`\<`void`\>

***

<a id="stopContainers"></a>

### stopContainers()

> **stopContainers**(`__namedParameters`): `Promise`\<`object`[]\>

Defined in: [src/ax/funcs/docker.ts:198](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxfuncsdockertsl198)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `__namedParameters` | `Readonly`\<\{ `remove`: `boolean`; `tag`: `string`; `timeout`: `number`; \}\> |

#### Returns

`Promise`\<`object`[]\>

***

<a id="toFunction"></a>

### toFunction()

> **toFunction**(): [`AxFunction`](#apidocs/typealiasaxfunction)

Defined in: [src/ax/funcs/docker.ts:373](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxfuncsdockertsl373)

#### Returns

[`AxFunction`](#apidocs/typealiasaxfunction)
