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
