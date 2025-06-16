---
title: AxFieldValue
---

```ts
type AxFieldValue = 
  | string
  | string[]
  | number
  | boolean
  | object
  | null
  | undefined
  | {
  data: string;
  mimeType: string;
 }
  | object[]
  | {
  data: string;
  format: "wav";
 }
  | object[];
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/dsp/types.ts#L1
