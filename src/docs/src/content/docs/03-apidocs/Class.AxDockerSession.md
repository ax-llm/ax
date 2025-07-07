---
title: AxDockerSession
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/funcs/docker.ts#L56

## Constructors

<a id="constructors"></a>

### new AxDockerSession()

```ts
new AxDockerSession(apiUrl: string): AxDockerSession
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/funcs/docker.ts#L60

#### Parameters

| Parameter | Type | Default value |
| :------ | :------ | :------ |
| `apiUrl` | `string` | `'http://localhost:2375'` |

#### Returns

[`AxDockerSession`](/api/#03-apidocs/classaxdockersession)

## Methods

<a id="connectToContainer"></a>

### connectToContainer()

```ts
connectToContainer(containerId: string): Promise<void>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/funcs/docker.ts#L186

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `containerId` | `string` |

#### Returns

`Promise`\<`void`\>

***

<a id="createContainer"></a>

### createContainer()

```ts
createContainer(__namedParameters: Readonly<{
  doNotPullImage: boolean;
  imageName: string;
  tag: string;
  volumes: object[];
 }>): Promise<{
  Id: string;
}>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/funcs/docker.ts#L80

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `__namedParameters` | `Readonly`\<\{ `doNotPullImage`: `boolean`; `imageName`: `string`; `tag`: `string`; `volumes`: `object`[]; \}\> |

#### Returns

`Promise`\<\{
  `Id`: `string`;
 \}\>

***

<a id="executeCommand"></a>

### executeCommand()

```ts
executeCommand(command: string): Promise<string>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/funcs/docker.ts#L274

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `command` | `string` |

#### Returns

`Promise`\<`string`\>

***

<a id="findOrCreateContainer"></a>

### findOrCreateContainer()

```ts
findOrCreateContainer(__namedParameters: Readonly<{
  doNotPullImage: boolean;
  imageName: string;
  tag: string;
  volumes: object[];
 }>): Promise<{
  Id: string;
  isNew: boolean;
}>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/funcs/docker.ts#L128

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `__namedParameters` | `Readonly`\<\{ `doNotPullImage`: `boolean`; `imageName`: `string`; `tag`: `string`; `volumes`: `object`[]; \}\> |

#### Returns

`Promise`\<\{
  `Id`: `string`;
  `isNew`: `boolean`;
 \}\>

***

<a id="getContainerLogs"></a>

### getContainerLogs()

```ts
getContainerLogs(): Promise<string>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/funcs/docker.ts#L263

#### Returns

`Promise`\<`string`\>

***

<a id="listContainers"></a>

### listContainers()

```ts
listContainers(all: boolean): Promise<AxDockerContainer[]>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/funcs/docker.ts#L256

#### Parameters

| Parameter | Type | Default value |
| :------ | :------ | :------ |
| `all` | `boolean` | `false` |

#### Returns

`Promise`\<[`AxDockerContainer`](/api/#03-apidocs/interfaceaxdockercontainer)[]\>

***

<a id="pullImage"></a>

### pullImage()

```ts
pullImage(imageName: string): Promise<void>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/funcs/docker.ts#L64

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `imageName` | `string` |

#### Returns

`Promise`\<`void`\>

***

<a id="startContainer"></a>

### startContainer()

```ts
startContainer(): Promise<void>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/funcs/docker.ts#L169

#### Returns

`Promise`\<`void`\>

***

<a id="stopContainers"></a>

### stopContainers()

```ts
stopContainers(__namedParameters: Readonly<{
  remove: boolean;
  tag: string;
  timeout: number;
}>): Promise<object[]>
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/funcs/docker.ts#L198

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `__namedParameters` | `Readonly`\<\{ `remove`: `boolean`; `tag`: `string`; `timeout`: `number`; \}\> |

#### Returns

`Promise`\<`object`[]\>

***

<a id="toFunction"></a>

### toFunction()

```ts
toFunction(): AxFunction
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/funcs/docker.ts#L373

#### Returns

[`AxFunction`](/api/#03-apidocs/typealiasaxfunction)
