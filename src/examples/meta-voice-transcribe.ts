import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';

import { AxAIMetaModel, ai } from '@ax-llm/ax';

const audioPath = process.argv[2];
if (!audioPath) {
  throw new Error('Pass a mono WAV file path (16 kHz or 24 kHz)');
}

if (extname(audioPath).toLowerCase() !== '.wav') {
  throw new Error('Meta Voice batch transcription requires a WAV file');
}
if (!process.env.MODEL_API_KEY) throw new Error('Set MODEL_API_KEY');
const voice = ai({
  name: 'meta',
  apiKey: process.env.MODEL_API_KEY!,
});

const transcript = await voice.transcribe({
  model: AxAIMetaModel.MuseVoiceTranscribe10,
  audio: {
    data: readFileSync(audioPath).toString('base64'),
    format: 'wav',
    filename: basename(audioPath),
  },
  mode: 'diarization',
  languageBias: ['en'],
  keywords: ['Ax'],
});

console.log(JSON.stringify(transcript, null, 2));
