---
title: AxPromptTemplate
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/prompt.ts#L41

## Constructors

<a id="constructors"></a>

### new AxPromptTemplate()

```ts
new AxPromptTemplate(
   sig: Readonly<AxSignature>, 
   options?: Readonly<AxPromptTemplateOptions>, 
   fieldTemplates?: Record<string, AxFieldTemplateFn>): AxPromptTemplate
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/prompt.ts#L48

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `sig` | `Readonly`\<[`AxSignature`](/api/#03-apidocs/classaxsignature)\> |
| `options`? | `Readonly`\<[`AxPromptTemplateOptions`](/api/#03-apidocs/interfaceaxprompttemplateoptions)\> |
| `fieldTemplates`? | `Record`\<`string`, [`AxFieldTemplateFn`](/api/#03-apidocs/typealiasaxfieldtemplatefn)\> |

#### Returns

[`AxPromptTemplate`](/api/#03-apidocs/classaxprompttemplate)

## Methods

<a id="render"></a>

### render()

```ts
render<T>(values: T | readonly AxMessage<T>[], __namedParameters: Readonly<{
  demos: Record<string, AxFieldValue>[];
  examples: Record<string, AxFieldValue>[];
  skipSystemPrompt: boolean;
 }>): (
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

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/prompt.ts#L103

#### Type Parameters

| Type Parameter |
| :------ |
| `T` *extends* [`AxGenIn`](/api/#03-apidocs/typealiasaxgenin) |

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `values` | `T` \| readonly [`AxMessage`](/api/#03-apidocs/typealiasaxmessage)\<`T`\>[] |
| `__namedParameters` | `Readonly`\<\{ `demos`: `Record`\<`string`, [`AxFieldValue`](/api/#03-apidocs/typealiasaxfieldvalue)\>[]; `examples`: `Record`\<`string`, [`AxFieldValue`](/api/#03-apidocs/typealiasaxfieldvalue)\>[]; `skipSystemPrompt`: `boolean`; \}\> |

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

<a id="renderExtraFields"></a>

### renderExtraFields()

```ts
renderExtraFields(extraFields: readonly AxIField[]): (
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
 })[]
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/prompt.ts#L232

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `extraFields` | readonly [`AxIField`](/api/#03-apidocs/typealiasaxifield)[] |

#### Returns

(
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
 \})[]
