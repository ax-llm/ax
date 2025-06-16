---
title: AxProgramForwardOptions
---

```ts
type AxProgramForwardOptions = object;
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/program.ts#L35

## Type declaration

| Name | Type |
| :------ | :------ |
| <a id="abortSignal"></a> `abortSignal`? | `AbortSignal` |
| <a id="ai"></a> `ai`? | [`AxAIService`](/api/#03-apidocs/interfaceaxaiservice) |
| <a id="asserts"></a> `asserts`? | [`AxAssertion`](/api/#03-apidocs/interfaceaxassertion)[] |
| <a id="debug"></a> `debug`? | `boolean` |
| <a id="debugHideSystemPrompt"></a> `debugHideSystemPrompt`? | `boolean` |
| <a id="description"></a> `description`? | `string` |
| <a id="excludeContentFromTrace"></a> `excludeContentFromTrace`? | `boolean` |
| <a id="fastFail"></a> `fastFail`? | `boolean` |
| <a id="functionCall"></a> `functionCall`? | [`AxChatRequest`](/api/#03-apidocs/typealiasaxchatrequest)\[`"functionCall"`\] |
| <a id="functions"></a> `functions`? | [`AxInputFunctionType`](/api/#03-apidocs/typealiasaxinputfunctiontype) |
| <a id="logger"></a> `logger`? | [`AxLoggerFunction`](/api/#03-apidocs/typealiasaxloggerfunction) |
| <a id="maxRetries"></a> `maxRetries`? | `number` |
| <a id="maxSteps"></a> `maxSteps`? | `number` |
| <a id="mem"></a> `mem`? | [`AxAIMemory`](/api/#03-apidocs/interfaceaxaimemory) |
| <a id="model"></a> `model`? | `string` |
| <a id="modelConfig"></a> `modelConfig`? | [`AxModelConfig`](/api/#03-apidocs/typealiasaxmodelconfig) |
| <a id="promptTemplate"></a> `promptTemplate`? | *typeof* [`AxPromptTemplate`](/api/#03-apidocs/classaxprompttemplate) |
| <a id="rateLimiter"></a> `rateLimiter`? | [`AxRateLimiterFunction`](/api/#03-apidocs/typealiasaxratelimiterfunction) |
| <a id="sessionId"></a> `sessionId`? | `string` |
| <a id="showThoughts"></a> `showThoughts`? | `boolean` |
| <a id="stopFunction"></a> `stopFunction`? | `string` |
| <a id="stream"></a> `stream`? | `boolean` |
| <a id="streamingAsserts"></a> `streamingAsserts`? | [`AxStreamingAssertion`](/api/#03-apidocs/interfaceaxstreamingassertion)[] |
| <a id="thinkingTokenBudget"></a> `thinkingTokenBudget`? | `"minimal"` \| `"low"` \| `"medium"` \| `"high"` \| `"highest"` \| `"none"` |
| <a id="thoughtFieldName"></a> `thoughtFieldName`? | `string` |
| <a id="traceId"></a> `traceId`? | `string` |
| <a id="traceLabel"></a> `traceLabel`? | `string` |
| <a id="tracer"></a> `tracer`? | `Tracer` |
