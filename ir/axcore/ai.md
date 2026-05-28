# ai.axir Reference Notes

Reference files:

- `src/ax/ai/types.ts` for `AxChatRequest`, `AxChatResponse`, content parts,
  `AxEmbedRequest`, `AxEmbedResponse`, model config, options, function calls,
  usage, and provider metadata.
- `src/ax/ai/base.ts` for the `AxAIService` contract, model/config merging,
  request validation, features, metrics, and sync service behavior.
- Provider implementations under `src/ax/ai/*` for adapter-specific lowering.
