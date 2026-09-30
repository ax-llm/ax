# Output changes in Ax 25

Date, datetime and range fields parse by default in the generated languages. Text-contract outputs use the same ISO 8601 values as TypeScript. Set `parseDates: false` or `parse_dates: false` to retain model text. Call options override constructor options, including when their spellings differ.

Audio output fields render through the AI client's `speak()` by default. Set `renderAudio: false` or `render_audio: false` to retain text. Streaming deltas stay text unless a result picker buffers the result.

Speech results contain `data`, `format`, `mimeType`, `transcript`, and the available `sampleRate` and `channels`. The old `audio`, `mime_type` and `sample_rate` aliases are removed. JSON speech responses with a bare string `audio` key are rejected; providers must return an accepted data field such as `data`, `audio_data` or `audio.data`.

Malformed user content items now raise `AxAIServiceResponseError`, matching the other message validation failures.
