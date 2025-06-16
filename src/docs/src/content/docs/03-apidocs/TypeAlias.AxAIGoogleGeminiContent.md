---
title: AxAIGoogleGeminiContent
---

```ts
type AxAIGoogleGeminiContent = 
  | {
  parts: (
     | {
     text: string;
     thought: string;
    }
     | {
     inlineData: {
        data: string;
        mimeType: string;
       };
    }
     | {
     fileData: {
        fileUri: string;
        mimeType: string;
       };
    })[];
  role: "user";
 }
  | {
  parts: object[] | object[];
  role: "model";
 }
  | {
  parts: object[];
  role: "function";
};
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/google-gemini/types.ts#L48
