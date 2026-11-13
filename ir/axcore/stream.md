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

Text accompanying tool-call deltas accumulates in the sample's content before
the tool branch returns. It does not trigger extraction on that chunk, but a
later text-only chunk sees the complete text. Conversation history uses the
same cumulative text through `fold_chat_response_stream`. The mixed-tool-text
fixtures pin incremental deltas and the next request's assistant/tool messages
for streaming and non-streaming calls, including fragmented tool arguments.
