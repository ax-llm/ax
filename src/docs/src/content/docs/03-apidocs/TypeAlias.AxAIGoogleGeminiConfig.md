---
title: AxAIGoogleGeminiConfig
---

```ts
type AxAIGoogleGeminiConfig = AxModelConfig & object;
```

Defined in: https://github.com/ax-llm/ax/blob/5d189b5efb1a6d8f9665c1966845f7a5ac21c3f1/src/ax/ai/google-gemini/types.ts#L194

AxAIGoogleGeminiConfig: Configuration options for Google Gemini API

## Type declaration

| Name | Type |
| :------ | :------ |
| `autoTruncate`? | `boolean` |
| `dimensions`? | `number` |
| `embedModel`? | [`AxAIGoogleGeminiEmbedModel`](/api/#03-apidocs/enumerationaxaigooglegeminiembedmodel) |
| `embedType`? | [`AxAIGoogleGeminiEmbedTypes`](/api/#03-apidocs/enumerationaxaigooglegeminiembedtypes) |
| `model` | [`AxAIGoogleGeminiModel`](/api/#03-apidocs/enumerationaxaigooglegeminimodel) |
| `safetySettings`? | [`AxAIGoogleGeminiSafetySettings`](/api/#03-apidocs/typealiasaxaigooglegeminisafetysettings) |
| `thinking`? | [`AxAIGoogleGeminiThinkingConfig`](/api/#03-apidocs/typealiasaxaigooglegeminithinkingconfig) |
| `urlContext`? | `string` |
