---
title: AxAIAnthropicMessageStartEvent
---

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/anthropic/types.ts#L145

## Properties

| Property | Type |
| :------ | :------ |
| <a id="message"></a> `message` | `object` |
| `message.content` | \[\] |
| `message.id` | `string` |
| `message.model` | `string` |
| `message.role` | `"assistant"` |
| `message.stop_reason` | `null` \| `string` |
| `message.stop_sequence` | `null` \| `string` |
| `message.type` | `"message"` |
| `message.usage` | `object` |
| `message.usage.input_tokens` | `number` |
| `message.usage.output_tokens` | `number` |
| <a id="type"></a> `type` | `"message_start"` |
