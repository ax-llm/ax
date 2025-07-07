---
title: AxBalancerOptions
---

```ts
type AxBalancerOptions = object;
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/balance.ts#L31

Options for the balancer.

## Type declaration

| Name | Type |
| :------ | :------ |
| <a id="comparator"></a> `comparator`? | (`a`: [`AxAIService`](/api/#03-apidocs/interfaceaxaiservice), `b`: [`AxAIService`](/api/#03-apidocs/interfaceaxaiservice)) => `number` |
| <a id="debug"></a> `debug`? | `boolean` |
| <a id="initialBackoffMs"></a> `initialBackoffMs`? | `number` |
| <a id="maxBackoffMs"></a> `maxBackoffMs`? | `number` |
| <a id="maxRetries"></a> `maxRetries`? | `number` |
