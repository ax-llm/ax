---
title: AxDockerSession
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/funcs/docker.ts#L56

## Constructors

<a id="constructors"></a>

### new AxDockerSession()

> **new AxDockerSession**(`apiUrl`): [`AxDockerSession`](/api/#03-apidocs/classaxdockersession)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/funcs/docker.ts#L60

#### Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `apiUrl` | `string` | `'http://localhost:2375'` |

#### Returns

[`AxDockerSession`](/api/#03-apidocs/classaxdockersession)

## Methods

<a id="connectToContainer"></a>

### connectToContainer()

> **connectToContainer**(`containerId`): `Promise`\<`void`\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/funcs/docker.ts#L186

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

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/funcs/docker.ts#L80

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

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/funcs/docker.ts#L274

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

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/funcs/docker.ts#L128

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

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/funcs/docker.ts#L263

#### Returns

`Promise`\<`string`\>

***

<a id="listContainers"></a>

### listContainers()

> **listContainers**(`all`): `Promise`\<[`AxDockerContainer`](/api/#03-apidocs/interfaceaxdockercontainer)[]\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/funcs/docker.ts#L256

#### Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `all` | `boolean` | `false` |

#### Returns

`Promise`\<[`AxDockerContainer`](/api/#03-apidocs/interfaceaxdockercontainer)[]\>

***

<a id="pullImage"></a>

### pullImage()

> **pullImage**(`imageName`): `Promise`\<`void`\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/funcs/docker.ts#L64

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

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/funcs/docker.ts#L169

#### Returns

`Promise`\<`void`\>

***

<a id="stopContainers"></a>

### stopContainers()

> **stopContainers**(`__namedParameters`): `Promise`\<`object`[]\>

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/funcs/docker.ts#L198

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `__namedParameters` | `Readonly`\<\{ `remove`: `boolean`; `tag`: `string`; `timeout`: `number`; \}\> |

#### Returns

`Promise`\<`object`[]\>

***

<a id="toFunction"></a>

### toFunction()

> **toFunction**(): [`AxFunction`](/api/#03-apidocs/typealiasaxfunction)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/funcs/docker.ts#L373

#### Returns

[`AxFunction`](/api/#03-apidocs/typealiasaxfunction)
