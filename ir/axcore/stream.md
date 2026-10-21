# stream.axir Reference Notes

Reference files:

- `src/ax/dsp/response/streaming.ts` for streaming response processing.
- `src/ax/dsp/response/structuredDelta.ts` for structured delta handling.
- `src/ax/dsp/streaming*.test.ts` for stream folding edge cases.

Core operations:

- `stream_extraction_route` selects exactly one path: structured JSON for
  complex signatures and prompt extraction otherwise.
- `stream_structured_delta` filters internal fields, withholds an incomplete
  repaired final array item, emits only newly appended array elements and
  prefix-growing string suffixes, and suppresses unchanged values.

These operations port the deterministic semantics exercised by generated
conformance runners. They do not add a new incremental AxGen API to the five
generated packages.

Partial JSON repair checks whether the cut is inside a quoted string before
repairing commas, numbers, dangling keys, or primitive literals. Its structural
comma scan tracks quotes and escapes. Public `streaming_forward` regressions
assert intermediate deltas as well as the final output, preventing temporary
string corruption from being hidden by the completed JSON.
