---
title: AxAIMemory
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/mem/types.ts#L3

## Methods

<a id="add"></a>

### add()

```ts
add(result: 
  | readonly (
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
  | Readonly<
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
 }>, sessionId?: string): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/mem/types.ts#L4

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `result` | \| readonly ( \| \{ `cache`: `boolean`; `content`: `string`; `role`: `"system"`; \} \| \{ `content`: \| `string` \| ( \| \{ `cache`: `boolean`; `text`: `string`; `type`: `"text"`; \} \| \{ `cache`: `boolean`; `details`: `"high"` \| `"low"` \| `"auto"`; `image`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `cache`: `boolean`; `data`: `string`; `format`: `"wav"`; `type`: `"audio"`; \})[]; `name`: `string`; `role`: `"user"`; \} \| \{ `cache`: `boolean`; `content`: `string`; `functionCalls`: `object`[]; `name`: `string`; `role`: `"assistant"`; \} \| \{ `cache`: `boolean`; `functionId`: `string`; `isError`: `boolean`; `result`: `string`; `role`: `"function"`; \})[] \| `Readonly`\< \| \{ `cache`: `boolean`; `content`: `string`; `role`: `"system"`; \} \| \{ `content`: \| `string` \| ( \| \{ `cache`: `boolean`; `text`: `string`; `type`: `"text"`; \} \| \{ `cache`: `boolean`; `details`: `"high"` \| `"low"` \| `"auto"`; `image`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `cache`: `boolean`; `data`: `string`; `format`: `"wav"`; `type`: `"audio"`; \})[]; `name`: `string`; `role`: `"user"`; \} \| \{ `cache`: `boolean`; `content`: `string`; `functionCalls`: `object`[]; `name`: `string`; `role`: `"assistant"`; \} \| \{ `cache`: `boolean`; `functionId`: `string`; `isError`: `boolean`; `result`: `string`; `role`: `"function"`; \}\> |
| `sessionId`? | `string` |

#### Returns

`void`

***

<a id="addResult"></a>

### addResult()

```ts
addResult(result: Readonly<AxChatResponseResult>, sessionId?: string): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/mem/types.ts#L10

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `result` | `Readonly`\<[`AxChatResponseResult`](/api/#03-apidocs/typealiasaxchatresponseresult)\> |
| `sessionId`? | `string` |

#### Returns

`void`

***

<a id="addTag"></a>

### addTag()

```ts
addTag(name: string, sessionId?: string): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/mem/types.ts#L25

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `name` | `string` |
| `sessionId`? | `string` |

#### Returns

`void`

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

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/mem/types.ts#L21

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

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/mem/types.ts#L18

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

***

<a id="reset"></a>

### reset()

```ts
reset(sessionId?: string): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/mem/types.ts#L19

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `sessionId`? | `string` |

#### Returns

`void`

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

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/mem/types.ts#L26

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

***

<a id="updateResult"></a>

### updateResult()

```ts
updateResult(result: Readonly<AxChatResponseResult> & object, sessionId?: string): void
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/mem/types.ts#L11

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `result` | `Readonly`\<[`AxChatResponseResult`](/api/#03-apidocs/typealiasaxchatresponseresult)\> & `object` |
| `sessionId`? | `string` |

#### Returns

`void`
