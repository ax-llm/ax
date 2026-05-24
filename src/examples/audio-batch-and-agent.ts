import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  AxAgentClarificationError,
  AxAIOpenAIModel,
  type AxChatAudioOutput,
  AxMockAIService,
  agent,
  ai,
  ax,
} from '@ax-llm/ax';

const audioExtension = (audio: Readonly<AxChatAudioOutput>) => {
  if (audio.format === 'pcm16' || audio.format === 'pcm') return 'pcm';
  if (audio.format) return audio.format;
  if (audio.mimeType?.includes('mpeg')) return 'mp3';
  if (audio.mimeType?.includes('wav')) return 'wav';
  if (audio.mimeType?.includes('ogg')) return 'ogg';
  return 'bin';
};

const writeAudioArtifact = async (
  name: string,
  artifact: Readonly<AxChatAudioOutput>
) => {
  const outputDir = new URL('./output/', import.meta.url);
  await mkdir(outputDir, { recursive: true });

  const path = new URL(`${name}.${audioExtension(artifact)}`, outputDir);
  const bytes = Buffer.from(artifact.data, 'base64');
  await writeFile(path, bytes);

  const filePath = fileURLToPath(path);
  console.log(`${name} audio file:`, filePath, `(${bytes.length} bytes)`);
  return filePath;
};

const playAudio = (path: string) => {
  const commands =
    process.platform === 'darwin'
      ? [['afplay', path]]
      : process.platform === 'win32'
        ? [
            [
              'powershell',
              '-NoProfile',
              '-Command',
              `(New-Object Media.SoundPlayer '${path.replaceAll("'", "''")}').PlaySync()`,
            ],
          ]
        : [
            ['ffplay', '-nodisp', '-autoexit', '-loglevel', 'quiet', path],
            ['mpg123', '-q', path],
            ['paplay', path],
            ['aplay', path],
          ];

  for (const [command, ...args] of commands) {
    console.log(`Playing with ${command}:`, path);
    const result = spawnSync(command, args, { stdio: 'inherit' });
    if (!result.error && result.status === 0) {
      return;
    }
  }

  const fallback =
    process.platform === 'darwin'
      ? `afplay "${path}"`
      : process.platform === 'win32'
        ? `start "" "${path}"`
        : `ffplay -nodisp -autoexit "${path}"`;
  console.warn(`Could not play ${path}. Try manually: ${fallback}`);
};

const audio = {
  data: (
    await readFile(new URL('./assets/presentation.wav', import.meta.url))
  ).toString('base64'),
  format: 'wav' as const,
};

const mock = new AxMockAIService({
  chatResponse: {
    results: [
      {
        index: 0,
        content:
          'Speech: Welcome to the audio artifact example.\nSummary: Audio artifacts synthesize a script field.',
        finishReason: 'stop',
      },
    ],
    modelUsage: {
      ai: 'mock',
      model: 'mock',
      tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    },
  },
  transcribeResponse: {
    text: 'This is the transcribed presentation audio.',
  },
  speechResponse: (req) => ({
    data: 'YXVkaW8=',
    format: req.format ?? 'mp3',
    mimeType: 'audio/mpeg',
    transcript: req.text,
  }),
});

const transcript = await mock.transcribe({
  audio,
  model: 'whisper-large-v3-turbo',
});
console.log('transcript:', transcript.text);

const spoken = await mock.speak({
  text: 'Direct text to speech works on AI services.',
  voice: 'alloy',
  format: 'mp3',
});
console.log('direct speech transcript:', spoken.transcript);

const say = ax('question:string -> speech:audio, summary:string');
const scripted = await say.forward(
  mock,
  { question: 'Explain audio artifacts in one line.' },
  {
    speech: {
      speak: { voice: 'alloy', format: 'mp3' },
      fields: {
        speech: { voice: 'alloy' },
      },
    },
  }
);
console.log('artifact transcript:', scripted.speech.transcript);
console.log('summary:', scripted.summary);

const voiceAgent = agent(
  'recording:audio, question:string -> speech:audio, summary:string',
  {
    agentIdentity: {
      name: 'Voice Helper',
      description:
        'Turns a recorded question into a short spoken answer and summary.',
    },
  }
);

if (process.env.OPENAI_APIKEY) {
  const llm = ai({
    name: 'openai',
    apiKey: process.env.OPENAI_APIKEY,
    config: { model: AxAIOpenAIModel.GPT4OMini },
  });

  const liveSpeech = await llm.speak({
    text: 'This file was generated with the direct Ax text to speech API.',
    model: 'gpt-4o-mini-tts',
    voice: 'alloy',
    format: 'mp3',
  });
  playAudio(await writeAudioArtifact('openai-direct-speech', liveSpeech));

  try {
    const res = await voiceAgent.forward(
      llm,
      {
        recording: audio,
        question:
          'Use the transcribed recording to produce a short spoken answer and summary. If the transcript is brief, summarize what is available without asking follow-up questions.',
      },
      {
        speech: {
          transcribe: { model: 'gpt-4o-mini-transcribe' },
          speak: {
            model: 'gpt-4o-mini-tts',
            voice: 'alloy',
            format: 'mp3',
          },
        },
      }
    );
    console.log('agent speech transcript:', res.speech.transcript);
    console.log('agent summary:', res.summary);
    playAudio(await writeAudioArtifact('openai-agent-speech', res.speech));
  } catch (error) {
    if (!(error instanceof AxAgentClarificationError)) {
      throw error;
    }
    console.log('agent requested clarification:', error.question);
  }
} else {
  console.log('Set OPENAI_APIKEY to run the live agent audio example.');
}
