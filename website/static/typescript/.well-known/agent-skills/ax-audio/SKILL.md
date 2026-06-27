---
name: ax-audio
description: This skill helps an LLM generate correct audio code with @ax-llm/ax. Use when the user asks about ai.transcribe(), ai.speak(), signature audio inputs or outputs, agent audio behavior, .chat() conversational audio, OpenAI audio or realtime models, Gemini Live native audio, Grok Voice Agent models, voices, formats, transcripts, or how audio fits with structured outputs.
version: "22.0.7"
---

# Audio I/O Codegen Rules (@ax-llm/ax)

Use this skill for audio in Ax. Pick the smallest audio surface that matches the job:

- Use `ai.transcribe(...)` for batch speech-to-text.
- Use `ai.speak(...)` for batch text-to-speech.
- Use `speech:audio` signature outputs for structured programs that should return synthesized audio artifacts.
- Use `.chat()` audio config for conversational or realtime audio turns.

## Core Rules

- Input `:audio` is an audio input value: `{ data, format?, mimeType?, sampleRate?, channels? }`.
- Output `:audio` is a scripted audio artifact. The model returns plain text for that field; Ax synthesizes it after structured output parsing.
- Output audio JSON schema is model-facing `string`, not a binary object.
- Agents transcribe input audio fields before planner/executor/responder stages by default, so agent stages see text instead of base64 audio.
- Realtime and conversational audio still use `.chat()` and `modelConfig.audio`.
- Batch signature audio artifacts use forward-time `speech` options, not `modelConfig.audio`.

## Direct Batch APIs

```typescript
import { ai } from '@ax-llm/ax';

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_APIKEY! });

const transcript = await llm.transcribe({
  audio: { data: base64Wav, format: 'wav' },
  model: 'gpt-4o-mini-transcribe',
  language: 'en',
  prompt: 'Product support call',
});

const speech = await llm.speak({
  text: transcript.text,
  model: 'gpt-4o-mini-tts',
  voice: 'alloy',
  format: 'mp3',
});

console.log(transcript.text);
console.log(speech.data);
console.log(speech.transcript);
```

Providers without the requested batch audio capability throw `AxMediaNotSupportedError`.

## Signature Audio Artifacts

```typescript
import { ai, ax } from '@ax-llm/ax';

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_APIKEY! });
const say = ax('question:string -> speech:audio, summary:string');

const result = await say.forward(
  llm,
  { question: 'Explain retries in one sentence.' },
  {
    speech: {
      speak: { voice: 'alloy', format: 'mp3' },
      fields: {
        speech: { voice: 'alloy' },
      },
    },
  }
);

console.log(result.summary);
console.log(result.speech.data);
console.log(result.speech.mimeType);
console.log(result.speech.transcript);
```

The model emits a text script for `speech`; Ax replaces it with `AxChatAudioOutput` after result selection. If the field already contains an audio artifact with `{ data }` or `{ id }`, Ax leaves it alone.

## Agent Audio Inputs

```typescript
import { agent, ai } from '@ax-llm/ax';

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_APIKEY! });

const voiceAgent = agent(
  'recording:audio, question:string -> speech:audio, summary:string',
  {
    agentIdentity: {
      name: 'Voice Assistant',
      description: 'Answers spoken requests with spoken and written output',
    },
    contextFields: [],
  }
);

const result = await voiceAgent.forward(
  llm,
  {
    recording: { data: base64Wav, format: 'wav' },
    question: 'What should I do next?',
  },
  {
    speech: {
      transcribe: { model: 'gpt-4o-mini-transcribe' },
      speak: { voice: 'alloy', format: 'mp3' },
    },
  }
);

console.log(result.summary);
console.log(result.speech.data);
```

The agent runtime transcribes `recording` first and passes the transcript through the internal agent stages. Use direct `ax(...)` or `.chat()` when you specifically want native audio understanding in the model call.

## Conversational `.chat()` Audio

Use `modelConfig.audio` for conversational audio turns where audio is part of the chat response instead of a structured signature field.

```typescript
const res = await llm.chat({
  chatPrompt: [{ role: 'user', content: 'Say hello out loud.' }],
  modelConfig: {
    audio: { output: { enabled: true, voice: 'alloy', format: 'wav' } },
  },
});

console.log(res.results[0]?.content);
console.log(res.results[0]?.audio?.data);
console.log(res.results[0]?.audio?.transcript);
```

## Config Shape

```typescript
type AxAudioFormat =
  | 'wav'
  | 'mp3'
  | 'flac'
  | 'opus'
  | 'aac'
  | 'pcm16'
  | 'pcm'
  | 'ogg'
  | 'raw'
  | 'mulaw'
  | 'ulaw'
  | 'alaw';

type AxSpeechConfig = {
  transcribe?: {
    model?: string;
    language?: string;
    prompt?: string;
  };
  speak?: {
    model?: string;
    voice?: string;
    format?: AxAudioFormat;
  };
  fields?: Record<
    string,
    {
      model?: string;
      voice?: string;
      format?: AxAudioFormat;
    }
  >;
};
```

## OpenAI Defaults

Use `axAIOpenAIAudioDefaultConfig()` for OpenAI request-based audio chat:

- model: `gpt-audio-mini`
- output enabled
- voice: `alloy`
- output format: `wav`
- transcript enabled
- streaming disabled by default
- audio input formats: `wav`, `mp3`
- audio output formats: `wav`, `mp3`, `flac`, `opus`, `aac`, `pcm16`

```typescript
import { ai, axAIOpenAIAudioDefaultConfig } from '@ax-llm/ax';

const openai = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  config: axAIOpenAIAudioDefaultConfig(),
});

const res = await openai.chat({
  chatPrompt: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'What is in this recording?' },
        { type: 'audio', data: base64Wav, format: 'wav' },
      ],
    },
  ],
});

console.log(res.results[0]?.content);
console.log(res.results[0]?.audio?.data);
```

Use `axAIOpenAIRealtimeDefaultConfig()` for OpenAI realtime speech-to-speech:

- model: `gpt-realtime-2`
- output enabled
- voice: `marin`
- output format: `pcm16`
- input default: `audio/pcm`, mono, 24000 Hz
- turn timeout: `30000`
- streaming disabled by default

Use `axAIOpenAIRealtimeTranscriptionDefaultConfig()` for realtime transcript deltas:

- model: `gpt-realtime-whisper`
- input default: `audio/pcm`, mono, 24000 Hz
- output audio disabled; transcript text is returned on `content`

Realtime models use a one-turn WebSocket call under `.chat()`. In Node, pass a WebSocket constructor through request options:

```typescript
import WebSocket from 'ws';
import { ai, axAIOpenAIRealtimeDefaultConfig } from '@ax-llm/ax';

const openai = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  config: axAIOpenAIRealtimeDefaultConfig(),
});

const stream = await openai.chat(
  {
    chatPrompt: [{ role: 'user', content: 'Say hello out loud.' }],
  },
  { stream: true, webSocket: WebSocket }
);
```

For follow-up turns, keep the assistant audio reference in history:

```typescript
await openai.chat({
  chatPrompt: [
    { role: 'assistant', audio: { id: previousAudioId } },
    { role: 'user', content: 'Repeat that more slowly.' },
  ],
});
```

## Gemini Live Defaults

Use `axAIGoogleGeminiLiveAudioDefaultConfig()` for Gemini native audio:

- model: `gemini-2.5-flash-native-audio-preview-12-2025`
- output enabled
- voice: `Kore`
- output format: `pcm16`
- output sample rate: `24000`
- input default: `audio/pcm;rate=16000`, mono
- transcript enabled
- turn timeout: `30000`
- streaming disabled by default

```typescript
import { ai, axAIGoogleGeminiLiveAudioDefaultConfig } from '@ax-llm/ax';

const gemini = ai({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY!,
  config: axAIGoogleGeminiLiveAudioDefaultConfig(),
});

const res = await gemini.chat({
  chatPrompt: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Answer this spoken question.' },
        {
          type: 'audio',
          data: base64Pcm16,
          format: 'pcm16',
          sampleRate: 16000,
          channels: 1,
        },
      ],
    },
  ],
});

console.log(res.results[0]?.content);
console.log(res.results[0]?.audio?.data);
```

Gemini Live uses a one-turn WebSocket call under `.chat()`. It expects PCM input for native audio turns; use `format: 'pcm16'` or `mimeType: 'audio/pcm;rate=16000'`.

## Grok Voice Defaults

Use `axAIGrokVoiceDefaultConfig()` for xAI Grok Voice Agent:

- model: `grok-voice-think-fast-1.0`
- output enabled
- voice: `eve`
- output format: `pcm16`
- output sample rate: `24000`
- input default: `audio/pcm`, mono, 24000 Hz
- transcript enabled
- turn timeout: `30000`
- streaming disabled by default

```typescript
import WebSocket from 'ws';
import { ai, axAIGrokVoiceDefaultConfig } from '@ax-llm/ax';

const grok = ai({
  name: 'grok',
  apiKey: process.env.GROK_API_KEY!,
  config: axAIGrokVoiceDefaultConfig(),
});

const res = await grok.chat(
  {
    chatPrompt: [{ role: 'user', content: 'Say hello out loud.' }],
  },
  { webSocket: WebSocket }
);

console.log(res.results[0]?.content);
console.log(res.results[0]?.audio?.data);
```

Grok Voice uses a one-turn WebSocket call under `.chat()`. It expects PCM input for spoken input turns; use `format: 'pcm16'` or `mimeType: 'audio/pcm'`.

## Streaming Audio

OpenAI audio chat, OpenAI Realtime, Gemini Live, and Grok Voice all default to non-streaming, but each can stream deltas when you pass `{ stream: true }`.

```typescript
const stream = await llm.chat(
  {
    chatPrompt: [{ role: 'user', content: 'Say hello.' }],
  },
  { stream: true }
);

for await (const chunk of stream) {
  const audio = chunk.results[0]?.audio;
  if (audio?.isDelta) {
    playAudioChunk(audio.data);
  }
}
```

## Structured Outputs

Use signature audio outputs for structured speech artifacts:

```typescript
const gen = ax('question:string -> answer:string, speech:audio');
```

Use `.chat()` audio when the response itself is a conversational audio turn. Do not combine `.chat()` audio output with provider-native structured response formats unless that provider explicitly supports the combination.
