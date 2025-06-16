---
title: AxAgentOptions
---

```ts
type AxAgentOptions = Omit<AxProgramForwardOptions, "functions"> & object;
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/prompts/agent.ts#L33

## Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `debug`? | `boolean` | - |
| `disableSmartModelRouting`? | `boolean` | - |
| `excludeFieldsFromPassthrough`? | `string`[] | List of field names that should not be automatically passed from parent to child agents |
