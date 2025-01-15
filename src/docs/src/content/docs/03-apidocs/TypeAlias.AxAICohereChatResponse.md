---
title: AxAICohereChatResponse
---

> **AxAICohereChatResponse**: `object`

Defined in: [src/ax/ai/cohere/types.ts:89](#apidocs/httpsgithubcomax-llmaxblob3b79ada8d723949fcd8a76c2b6f48cf69d8394f8srcaxaicoheretypestsl89)

## Type declaration

<a id="finish_reason"></a>

### finish\_reason

> **finish\_reason**: `"COMPLETE"` \| `"ERROR"` \| `"ERROR_TOXIC"` \| `"ERROR_LIMIT"` \| `"USER_CANCEL"` \| `"MAX_TOKENS"`

<a id="generation_id"></a>

### generation\_id

> **generation\_id**: `string`

### meta

> \{ `billed_units`: \{ `input_tokens`: `number`; `output_tokens`: `number`; \}; \}

<a id="response_id"></a>

### response\_id

> **response\_id**: `string`

<a id="text"></a>

### text

> **text**: `string`

<a id="tool_calls"></a>

### tool\_calls

> **tool\_calls**: [`AxAICohereChatResponseToolCalls`](#apidocs/typealiasaxaicoherechatresponsetoolcalls)
