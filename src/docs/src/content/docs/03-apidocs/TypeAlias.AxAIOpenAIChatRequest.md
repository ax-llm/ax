---
title: AxAIOpenAIChatRequest
---

```ts
type AxAIOpenAIChatRequest<TModel> = object;
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/openai/chat_types.ts#L85

## Type Parameters

| Type Parameter |
| :------ |
| `TModel` |

## Type declaration

| Name | Type |
| :------ | :------ |
| <a id="frequency_penalty"></a> `frequency_penalty`? | `number` |
| <a id="logit_bias"></a> `logit_bias`? | `Map`\<`string`, `number`\> |
| <a id="max_completion_tokens"></a> `max_completion_tokens`? | `number` |
| <a id="messages"></a> `messages` | ( \| \{ `content`: `string`; `role`: `"system"`; \} \| \{ `content`: \| `string` \| ( \| \{ `text`: `string`; `type`: `"text"`; \} \| \{ `image_url`: \{ `details`: ...; `url`: ...; \}; `type`: `"image_url"`; \} \| \{ `input_audio`: \{ `data`: ...; `format`: ...; \}; `type`: `"input_audio"`; \})[]; `name`: `string`; `role`: `"user"`; \} \| \{ `content`: `string`; `name`: `string`; `role`: `"assistant"`; `tool_calls`: `object`[]; \} \| \{ `content`: `string`; `role`: `"tool"`; `tool_call_id`: `string`; \})[] |
| <a id="model"></a> `model` | `TModel` |
| <a id="n"></a> `n`? | `number` |
| <a id="organization"></a> `organization`? | `string` |
| <a id="presence_penalty"></a> `presence_penalty`? | `number` |
| <a id="reasoning_effort"></a> `reasoning_effort`? | `"low"` \| `"medium"` \| `"high"` |
| <a id="response_format"></a> `response_format`? | \{ `type`: `string`; \} |
| <a id="stop"></a> `stop`? | readonly `string`[] |
| <a id="store"></a> `store`? | `boolean` |
| <a id="stream"></a> `stream`? | `boolean` |
| <a id="temperature"></a> `temperature`? | `number` |
| <a id="tool_choice"></a> `tool_choice`? | \| `"none"` \| `"auto"` \| `"required"` \| \{ `function`: \{ `name`: `string`; \}; `type`: `"function"`; \} |
| <a id="tools"></a> `tools`? | `object`[] |
| <a id="top_p"></a> `top_p`? | `number` |
| <a id="user"></a> `user`? | `string` |
| <a id="web_search_options"></a> `web_search_options`? | \{ `search_context_size`: `"low"` \| `"medium"` \| `"high"`; `user_location`: \| \{ `approximate`: \{ `city`: `string`; `country`: `string`; `region`: `string`; `timezone`: `string`; `type`: `"approximate"`; \}; \} \| `null`; \} |
