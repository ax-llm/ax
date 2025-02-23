---
title: AxGenOptions
---

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/generate.ts#L56

## Properties

<a id="asserts"></a>

### asserts?

> `optional` **asserts**: [`AxAssertion`](/api/#03-apidocs/interfaceaxassertion)[]

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/generate.ts#L69

***

<a id="description"></a>

### description?

> `optional` **description**: `string`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/generate.ts#L63

***

<a id="fastFail"></a>

### fastFail?

> `optional` **fastFail**: `boolean`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/generate.ts#L71

***

<a id="functionCall"></a>

### functionCall?

> `optional` **functionCall**: `"auto"` \| \{ `function`: \{ `name`: `string`; \}; `type`: `"function"`; \} \| `"none"` \| `"required"`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/generate.ts#L66

***

<a id="functions"></a>

### functions?

> `optional` **functions**: [`AxInputFunctionType`](/api/#03-apidocs/typealiasaxinputfunctiontype)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/generate.ts#L65

***

<a id="maxRetries"></a>

### maxRetries?

> `optional` **maxRetries**: `number`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/generate.ts#L57

***

<a id="maxSteps"></a>

### maxSteps?

> `optional` **maxSteps**: `number`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/generate.ts#L58

***

<a id="mem"></a>

### mem?

> `optional` **mem**: [`AxAIMemory`](/api/#03-apidocs/interfaceaxaimemory)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/generate.ts#L59

***

<a id="promptTemplate"></a>

### promptTemplate?

> `optional` **promptTemplate**: *typeof* [`AxPromptTemplate`](/api/#03-apidocs/classaxprompttemplate)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/generate.ts#L68

***

<a id="rateLimiter"></a>

### rateLimiter?

> `optional` **rateLimiter**: [`AxRateLimiterFunction`](/api/#03-apidocs/typealiasaxratelimiterfunction)

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/generate.ts#L61

***

<a id="stopFunction"></a>

### stopFunction?

> `optional` **stopFunction**: `string`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/generate.ts#L67

***

<a id="stream"></a>

### stream?

> `optional` **stream**: `boolean`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/generate.ts#L62

***

<a id="streamingAsserts"></a>

### streamingAsserts?

> `optional` **streamingAsserts**: [`AxStreamingAssertion`](/api/#03-apidocs/interfaceaxstreamingassertion)[]

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/generate.ts#L70

***

<a id="tracer"></a>

### tracer?

> `optional` **tracer**: `Tracer`

Defined in: https://github.com/ax-llm/ax/blob/76f1e53f33743ee460569bb94d0bd3620db6e328/src/ax/dsp/generate.ts#L60
