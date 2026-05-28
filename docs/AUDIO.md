# Audio APIs

Ax treats audio as three related paths:

- Direct batch APIs: `ai.transcribe({ audio })` and `ai.speak({ text })`.
- Conversational audio: `.chat()` with request/response audio for providers that expose realtime or audio chat models.
- Signature audio artifacts: `speech:audio` outputs are model-facing strings. The model writes the script, then Ax calls `ai.speak(...)` and returns an audio artifact.

```ts
const say = ax('question:string -> speech:audio, summary:string');

const res = await say.forward(llm, { question: 'Greet the team.' }, {
  speech: {
    transcribe: { model: 'gpt-4o-mini-transcribe' },
    speak: { model: 'gpt-4o-mini-tts', voice: 'alloy', format: 'mp3' },
    fields: {
      speech: { voice: 'alloy' },
    },
  },
});

console.log(res.speech.data);
console.log(res.speech.transcript);
```

## Direct APIs

`ai.transcribe(...)` accepts `{ audio, model?, language?, prompt? }`, where `audio` is `{ data, format?, mimeType? }`.

`ai.speak(...)` accepts `{ text, model?, voice?, format? }` and returns `{ data, format?, mimeType?, transcript? }`.

Providers without a compatible batch endpoint throw `AxMediaNotSupportedError`.

Runnable examples:

- `src/examples/audio-batch-and-agent.ts` writes generated MP3 artifacts under `src/examples/output/` and plays them immediately.
- `src/examples/audio-chat.ts voice` streams realtime audio chunks, saves a WAV, and plays it when a local player is available.
- `src/examples/audio-chat.ts transcribe` streams `presentation.wav` into realtime transcription and prints transcript deltas.

## Signatures

Input `:audio` remains a media input:

```ts
const transcriber = ax('recording:audio -> transcript:string');
```

Output `:audio` is a synthesized artifact:

```ts
const narrator = ax('article:string -> narration:audio, summary:string');
```

For JSON schema and structured outputs, audio outputs are exposed to the model as strings. Ax never asks the model to put base64 audio into JSON.

## Agents

Agents transcribe top-level audio input fields before the distiller, executor, and responder stages run. The agent sees stable text, which keeps tool calls, memories, and structured output predictable.

Native audio understanding remains available through direct `ax()` and `.chat()` calls when you intentionally want the model to receive the audio bytes.

## Provider Notes

Current public provider docs change quickly; verify production pricing before committing volume.

| Provider | Batch STT | Batch TTS | Notes |
|---|---:|---:|---|
| OpenAI | Yes | Yes | Audio API supports `/audio/transcriptions` and `/audio/speech`; pricing lists `gpt-4o-mini-transcribe` and `gpt-4o-mini-tts`. |
| xAI | Yes | Yes | Voice APIs expose `/v1/stt` and `/v1/tts`; public docs list REST STT at `$0.10/hr` and TTS at `$15/1M characters`. |
| Gemini | Yes | Yes | Audio understanding uses Gemini `generateContent`; TTS uses Gemini TTS models through `generateContent`. |
| Mistral | Yes | Yes | Voxtral transcription uses `/v1/audio/transcriptions`; Voxtral TTS uses `/v1/audio/speech`. |

Official references:

- [OpenAI audio guide](https://platform.openai.com/docs/guides/audio)
- [OpenAI pricing](https://platform.openai.com/docs/pricing/)
- [xAI voice APIs](https://docs.x.ai/docs/guides/voice)
- [Mistral audio transcriptions](https://docs.mistral.ai/api/endpoint/audio/transcriptions)
- [Mistral audio speech](https://docs.mistral.ai/api/endpoint/audio/speech)
- [Gemini audio understanding](https://ai.google.dev/gemini-api/docs/audio)
- [Gemini TTS](https://docs.cloud.google.com/text-to-speech/docs/gemini-tts)
