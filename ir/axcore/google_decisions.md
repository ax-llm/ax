# Google Gemini Decisions

`google_decisions.axir` owns the dedicated Gemini Developer API contract:

- Named `noul`, `choice`, and `score` question validation, including text-only
  instructions and provider key/outcome limits.
- Text, image, audio, video, and PDF inputs, base64 limits, MIME/type matching,
  supported URI schemes, resolution, and explicit conversation separators.
- Required boolean/class/score signatures and value descriptions, local scalar
  thresholds, and native decision evidence with boolean confidence.
- Exact answer membership, finite values, probability distributions, legends,
  per-modality counts, zero output tokens, and requested-model provenance.

Native clients in all five generated languages call these helpers. Transport
retry, timeout, case-insensitive credential precedence, request snapshots, and
cancellation remain in the existing host wrappers. Safety failures remain HTTP
errors; this provider has no per-question refusal primitive or token streaming.

TypeScript-derived fixtures come from
`tools/axir/extractors/google-decisions-goldens.ts` and use
`ai_google_decisions_native`, `ai_chat`, and AxGen `forward` dispatch. Public
provider-backed examples are under each language’s generation directory.
