---
title: AxAIAnthropicMessageDeltaEvent
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/anthropic/types.ts#L201

## Properties

| Property | Type |
| :------ | :------ |
| <a id="delta"></a> `delta` | `object` |
| `delta.stop_reason` | `null` \| `"end_turn"` \| `"max_tokens"` \| `"stop_sequence"` |
| `delta.stop_sequence` | `null` \| `string` |
| <a id="type"></a> `type` | `"message_delta"` |
| <a id="usage"></a> `usage` | `object` |
| `usage.output_tokens` | `number` |
