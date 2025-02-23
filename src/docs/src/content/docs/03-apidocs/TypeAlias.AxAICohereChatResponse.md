---
title: AxAICohereChatResponse
---

> **AxAICohereChatResponse**: `object`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/ai/cohere/types.ts#L89

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

> **tool\_calls**: [`AxAICohereChatResponseToolCalls`](/api/#03-apidocs/typealiasaxaicoherechatresponsetoolcalls)
