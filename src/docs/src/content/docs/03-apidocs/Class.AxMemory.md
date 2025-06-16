---
title: AxMemory
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/mem/memory.ts#L180

## Implements

- [`AxAIMemory`](/api/#03-apidocs/interfaceaxaimemory)

## Constructors

<a id="constructors"></a>

### new AxMemory()

```ts
new AxMemory(limit: number, options?: object): AxMemory
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/mem/memory.ts#L184

#### Parameters

| Parameter | Type | Default value |
| :------ | :------ | :------ |
| `limit` | `number` | `defaultLimit` |
| `options`? | \{ `debug`: `boolean`; `debugHideSystemPrompt`: `boolean`; \} | `undefined` |
| `options.debug`? | `boolean` | `undefined` |
| `options.debugHideSystemPrompt`? | `boolean` | `undefined` |

#### Returns

[`AxMemory`](/api/#03-apidocs/classaxmemory)

## Methods

<a id="add"></a>

### add()

```ts
add(value: 
  | {
  cache: boolean;
  content: string;
  role: "system";
 }
  | {
  content:   | string
     | (
     | {
     cache: boolean;
     text: string;
     type: "text";
    }
     | {
     cache: boolean;
     details: "high" | "low" | "auto";
     image: string;
     mimeType: string;
     type: "image";
    }
     | {
     cache: boolean;
     data: string;
     format: "wav";
     type: "audio";
    })[];
  name: string;
  role: "user";
 }
  | {
  cache: boolean;
  content: string;
  functionCalls: object[];
  name: string;
  role: "assistant";
 }
  | {
  cache: boolean;
  functionId: string;
  isError: boolean;
  result: string;
  role: "function";
 }
  | (
  | {
  cache: boolean;
  content: string;
  role: "system";
 }
  | {
  content:   | string
     | (
     | {
     cache: boolean;
     text: string;
     type: "text";
    }
     | {
     cache: boolean;
     details: "high" | "low" | "auto";
     image: string;
     mimeType: string;
     type: "image";
    }
     | {
     cache: boolean;
     data: string;
     format: "wav";
     type: "audio";
    })[];
  name: string;
  role: "user";
 }
  | {
  cache: boolean;
  content: string;
  functionCalls: object[];
  name: string;
  role: "assistant";
 }
  | {
  cache: boolean;
  functionId: string;
  isError: boolean;
  result: string;
  role: "function";
 })[], sessionId?: string): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/mem/memory.ts#L206

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `value` | \| \{ `cache`: `boolean`; `content`: `string`; `role`: `"system"`; \} \| \{ `content`: \| `string` \| ( \| \{ `cache`: `boolean`; `text`: `string`; `type`: `"text"`; \} \| \{ `cache`: `boolean`; `details`: `"high"` \| `"low"` \| `"auto"`; `image`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `cache`: `boolean`; `data`: `string`; `format`: `"wav"`; `type`: `"audio"`; \})[]; `name`: `string`; `role`: `"user"`; \} \| \{ `cache`: `boolean`; `content`: `string`; `functionCalls`: `object`[]; `name`: `string`; `role`: `"assistant"`; \} \| \{ `cache`: `boolean`; `functionId`: `string`; `isError`: `boolean`; `result`: `string`; `role`: `"function"`; \} \| ( \| \{ `cache`: `boolean`; `content`: `string`; `role`: `"system"`; \} \| \{ `content`: \| `string` \| ( \| \{ `cache`: `boolean`; `text`: `string`; `type`: `"text"`; \} \| \{ `cache`: `boolean`; `details`: `"high"` \| `"low"` \| `"auto"`; `image`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `cache`: `boolean`; `data`: `string`; `format`: `"wav"`; `type`: `"audio"`; \})[]; `name`: `string`; `role`: `"user"`; \} \| \{ `cache`: `boolean`; `content`: `string`; `functionCalls`: `object`[]; `name`: `string`; `role`: `"assistant"`; \} \| \{ `cache`: `boolean`; `functionId`: `string`; `isError`: `boolean`; `result`: `string`; `role`: `"function"`; \})[] |
| `sessionId`? | `string` |

#### Returns

`void`

#### Implementation of

[`AxAIMemory`](/api/#03-apidocs/interfaceaxaimemory).[`add`](/api/#03-apidocs/interfaceaxaimemorymdadd)

***

<a id="addResult"></a>

### addResult()

```ts
addResult(result: Readonly<AxChatResponseResult>, sessionId?: string): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/mem/memory.ts#L213

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `result` | `Readonly`\<[`AxChatResponseResult`](/api/#03-apidocs/typealiasaxchatresponseresult)\> |
| `sessionId`? | `string` |

#### Returns

`void`

#### Implementation of

[`AxAIMemory`](/api/#03-apidocs/interfaceaxaimemory).[`addResult`](/api/#03-apidocs/interfaceaxaimemorymdaddresult)

***

<a id="addTag"></a>

### addTag()

```ts
addTag(name: string, sessionId?: string): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/mem/memory.ts#L224

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `name` | `string` |
| `sessionId`? | `string` |

#### Returns

`void`

#### Implementation of

[`AxAIMemory`](/api/#03-apidocs/interfaceaxaimemory).[`addTag`](/api/#03-apidocs/interfaceaxaimemorymdaddtag)

***

<a id="getLast"></a>

### getLast()

```ts
getLast(sessionId?: string): 
  | undefined
  | {
  chat:   | {
     cache: boolean;
     content: string;
     role: "system";
    }
     | {
     content:   | string
        | (
        | {
        cache: boolean;
        text: string;
        type: "text";
       }
        | {
        cache: boolean;
        details: "high" | "low" | "auto";
        image: string;
        mimeType: string;
        type: "image";
       }
        | {
        cache: boolean;
        data: string;
        format: "wav";
        type: "audio";
       })[];
     name: string;
     role: "user";
    }
     | {
     cache: boolean;
     content: string;
     functionCalls: object[];
     name: string;
     role: "assistant";
    }
     | {
     cache: boolean;
     functionId: string;
     isError: boolean;
     result: string;
     role: "function";
    };
  tags: string[];
}
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/mem/memory.ts#L236

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `sessionId`? | `string` |

#### Returns

  \| `undefined`
  \| \{
  `chat`:   \| \{
     `cache`: `boolean`;
     `content`: `string`;
     `role`: `"system"`;
    \}
     \| \{
     `content`:   \| `string`
        \| (
        \| \{
        `cache`: `boolean`;
        `text`: `string`;
        `type`: `"text"`;
       \}
        \| \{
        `cache`: `boolean`;
        `details`: `"high"` \| `"low"` \| `"auto"`;
        `image`: `string`;
        `mimeType`: `string`;
        `type`: `"image"`;
       \}
        \| \{
        `cache`: `boolean`;
        `data`: `string`;
        `format`: `"wav"`;
        `type`: `"audio"`;
       \})[];
     `name`: `string`;
     `role`: `"user"`;
    \}
     \| \{
     `cache`: `boolean`;
     `content`: `string`;
     `functionCalls`: `object`[];
     `name`: `string`;
     `role`: `"assistant"`;
    \}
     \| \{
     `cache`: `boolean`;
     `functionId`: `string`;
     `isError`: `boolean`;
     `result`: `string`;
     `role`: `"function"`;
    \};
  `tags`: `string`[];
 \}

#### Implementation of

[`AxAIMemory`](/api/#03-apidocs/interfaceaxaimemory).[`getLast`](/api/#03-apidocs/interfaceaxaimemorymdgetlast)

***

<a id="history"></a>

### history()

```ts
history(sessionId?: string): (
  | {
  cache: boolean;
  content: string;
  role: "system";
 }
  | {
  content:   | string
     | (
     | {
     cache: boolean;
     text: string;
     type: "text";
    }
     | {
     cache: boolean;
     details: "high" | "low" | "auto";
     image: string;
     mimeType: string;
     type: "image";
    }
     | {
     cache: boolean;
     data: string;
     format: "wav";
     type: "audio";
    })[];
  name: string;
  role: "user";
 }
  | {
  cache: boolean;
  content: string;
  functionCalls: object[];
  name: string;
  role: "assistant";
 }
  | {
  cache: boolean;
  functionId: string;
  isError: boolean;
  result: string;
  role: "function";
 })[]
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/mem/memory.ts#L232

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `sessionId`? | `string` |

#### Returns

(
  \| \{
  `cache`: `boolean`;
  `content`: `string`;
  `role`: `"system"`;
 \}
  \| \{
  `content`:   \| `string`
     \| (
     \| \{
     `cache`: `boolean`;
     `text`: `string`;
     `type`: `"text"`;
    \}
     \| \{
     `cache`: `boolean`;
     `details`: `"high"` \| `"low"` \| `"auto"`;
     `image`: `string`;
     `mimeType`: `string`;
     `type`: `"image"`;
    \}
     \| \{
     `cache`: `boolean`;
     `data`: `string`;
     `format`: `"wav"`;
     `type`: `"audio"`;
    \})[];
  `name`: `string`;
  `role`: `"user"`;
 \}
  \| \{
  `cache`: `boolean`;
  `content`: `string`;
  `functionCalls`: `object`[];
  `name`: `string`;
  `role`: `"assistant"`;
 \}
  \| \{
  `cache`: `boolean`;
  `functionId`: `string`;
  `isError`: `boolean`;
  `result`: `string`;
  `role`: `"function"`;
 \})[]

#### Implementation of

[`AxAIMemory`](/api/#03-apidocs/interfaceaxaimemory).[`history`](/api/#03-apidocs/interfaceaxaimemorymdhistory)

***

<a id="reset"></a>

### reset()

```ts
reset(sessionId?: string): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/mem/memory.ts#L240

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `sessionId`? | `string` |

#### Returns

`void`

#### Implementation of

[`AxAIMemory`](/api/#03-apidocs/interfaceaxaimemory).[`reset`](/api/#03-apidocs/interfaceaxaimemorymdreset)

***

<a id="rewindToTag"></a>

### rewindToTag()

```ts
rewindToTag(name: string, sessionId?: string): (
  | {
  cache: boolean;
  content: string;
  role: "system";
 }
  | {
  content:   | string
     | (
     | {
     cache: boolean;
     text: string;
     type: "text";
    }
     | {
     cache: boolean;
     details: "high" | "low" | "auto";
     image: string;
     mimeType: string;
     type: "image";
    }
     | {
     cache: boolean;
     data: string;
     format: "wav";
     type: "audio";
    })[];
  name: string;
  role: "user";
 }
  | {
  cache: boolean;
  content: string;
  functionCalls: object[];
  name: string;
  role: "assistant";
 }
  | {
  cache: boolean;
  functionId: string;
  isError: boolean;
  result: string;
  role: "function";
 })[]
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/mem/memory.ts#L228

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `name` | `string` |
| `sessionId`? | `string` |

#### Returns

(
  \| \{
  `cache`: `boolean`;
  `content`: `string`;
  `role`: `"system"`;
 \}
  \| \{
  `content`:   \| `string`
     \| (
     \| \{
     `cache`: `boolean`;
     `text`: `string`;
     `type`: `"text"`;
    \}
     \| \{
     `cache`: `boolean`;
     `details`: `"high"` \| `"low"` \| `"auto"`;
     `image`: `string`;
     `mimeType`: `string`;
     `type`: `"image"`;
    \}
     \| \{
     `cache`: `boolean`;
     `data`: `string`;
     `format`: `"wav"`;
     `type`: `"audio"`;
    \})[];
  `name`: `string`;
  `role`: `"user"`;
 \}
  \| \{
  `cache`: `boolean`;
  `content`: `string`;
  `functionCalls`: `object`[];
  `name`: `string`;
  `role`: `"assistant"`;
 \}
  \| \{
  `cache`: `boolean`;
  `functionId`: `string`;
  `isError`: `boolean`;
  `result`: `string`;
  `role`: `"function"`;
 \})[]

#### Implementation of

[`AxAIMemory`](/api/#03-apidocs/interfaceaxaimemory).[`rewindToTag`](/api/#03-apidocs/interfaceaxaimemorymdrewindtotag)

***

<a id="updateResult"></a>

### updateResult()

```ts
updateResult(result: Readonly<AxChatResponseResult>, sessionId?: string): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/mem/memory.ts#L217

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `result` | `Readonly`\<[`AxChatResponseResult`](/api/#03-apidocs/typealiasaxchatresponseresult)\> |
| `sessionId`? | `string` |

#### Returns

`void`

#### Implementation of

[`AxAIMemory`](/api/#03-apidocs/interfaceaxaimemory).[`updateResult`](/api/#03-apidocs/interfaceaxaimemorymdupdateresult)
