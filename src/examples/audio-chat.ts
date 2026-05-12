import { Buffer } from 'node:buffer';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import {
  type AxChatResponse,
  ai,
  axAIOpenAIRealtimeDefaultConfig,
  axAIOpenAIRealtimeTranscriptionDefaultConfig,
} from '@ax-llm/ax';

type AudioMode = 'voice' | 'transcribe';

const cliArgs = process.argv.slice(2);
const mode = (cliArgs.find((arg) => !arg.startsWith('--')) ??
  'voice') as AudioMode;
const outputDir = './src/examples/output';

const writeBytes = (name: string, bytes: Uint8Array) => {
  mkdirSync(outputDir, { recursive: true });
  const path = `${outputDir}/${name}`;
  writeFileSync(path, bytes);
  return path;
};

const pcm16ToWav = (
  pcm: Uint8Array,
  { sampleRate = 24_000, channels = 1 } = {}
) => {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * 2;
  const blockAlign = channels * 2;

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.byteLength, 40);

  return Buffer.concat([header, Buffer.from(pcm)]);
};

const wavToPcm16 = (wav: Buffer) => {
  if (wav.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error('Expected a RIFF WAV file');
  }

  let offset = 12;
  let sampleRate = 24_000;
  let channels = 1;
  let bitsPerSample = 16;
  let data: Buffer | undefined;

  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;

    if (id === 'fmt ') {
      const audioFormat = wav.readUInt16LE(start);
      channels = wav.readUInt16LE(start + 2);
      sampleRate = wav.readUInt32LE(start + 4);
      bitsPerSample = wav.readUInt16LE(start + 14);
      if (audioFormat !== 1 || bitsPerSample !== 16) {
        throw new Error('Expected uncompressed 16-bit PCM WAV audio');
      }
    }

    if (id === 'data') {
      data = wav.subarray(start, end);
      break;
    }

    offset = end + (size % 2);
  }

  if (!data) {
    throw new Error('WAV file does not contain a data chunk');
  }

  return { data, sampleRate, channels, bitsPerSample };
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
            ['paplay', path],
            ['aplay', path],
            ['ffplay', '-nodisp', '-autoexit', '-loglevel', 'quiet', path],
          ];

  for (const [command, ...args] of commands) {
    const result = spawnSync(command, args, { stdio: 'inherit' });
    if (!result.error && result.status === 0) {
      return;
    }
  }

  console.warn(`Could not find a local audio player for ${path}`);
};

const commandExists = (command: string) => {
  const result =
    process.platform === 'win32'
      ? spawnSync('where', [command], { stdio: 'ignore' })
      : spawnSync('sh', ['-lc', `command -v ${command}`], {
          stdio: 'ignore',
        });
  return result.status === 0;
};

const createPcm16StreamPlayer = ({
  sampleRate = 24_000,
  channels = 1,
} = {}) => {
  const commands = [
    {
      command: 'ffplay',
      args: [
        '-nodisp',
        '-autoexit',
        '-loglevel',
        'quiet',
        '-f',
        's16le',
        '-ar',
        String(sampleRate),
        '-ac',
        String(channels),
        '-i',
        'pipe:0',
      ],
    },
    {
      command: 'play',
      args: [
        '-q',
        '-t',
        'raw',
        '-b',
        '16',
        '-e',
        'signed-integer',
        '-r',
        String(sampleRate),
        '-c',
        String(channels),
        '-',
      ],
    },
    {
      command: 'aplay',
      args: [
        '-q',
        '-f',
        'S16_LE',
        '-r',
        String(sampleRate),
        '-c',
        String(channels),
      ],
    },
    {
      command: 'paplay',
      args: [
        '--raw',
        '--format=s16le',
        `--rate=${sampleRate}`,
        `--channels=${channels}`,
      ],
    },
  ];

  const selected = commands.find(({ command }) => commandExists(command));
  if (!selected) {
    console.warn(
      'Could not find ffplay, play, aplay, or paplay for live playback; will save and play the WAV after the response finishes'
    );
    return undefined;
  }

  const child = spawn(selected.command, selected.args, {
    stdio: ['pipe', 'ignore', 'inherit'],
  });
  let closed = false;
  child.once('close', () => {
    closed = true;
  });

  console.log(`Streaming audio to: ${selected.command}`);

  return {
    write: (bytes: Uint8Array) => {
      if (!closed && child.stdin.writable) {
        child.stdin.write(bytes);
      }
    },
    close: () =>
      new Promise<void>((resolve) => {
        if (closed || child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }

        const timer = setTimeout(() => {
          resolve();
        }, 1000);
        child.once('close', () => {
          clearTimeout(timer);
          resolve();
        });
        if (child.stdin.writable) {
          child.stdin.end();
        } else {
          resolve();
        }
      }),
    command: selected.command,
  };
};

const streamAudioToSpeaker = async (
  stream: ReadableStream<AxChatResponse>,
  outputName: string
) => {
  const player = createPcm16StreamPlayer();
  const reader = stream.getReader();
  const audioChunks: Buffer[] = [];
  let transcript = '';
  let heardFirstAudio = false;
  const startedAt = Date.now();
  const status = setInterval(() => {
    console.log(
      `Still waiting... ${Math.round((Date.now() - startedAt) / 1000)}s, chunks=${audioChunks.length}`
    );
  }, 5000);

  console.log('Waiting for streamed audio...');

  try {
    while (true) {
      const quietTimeoutMs = audioChunks.length > 0 ? 2500 : 30_000;
      const readResult = await new Promise<{
        done: boolean;
        value?: AxChatResponse;
        timedOut?: boolean;
      }>((resolve, reject) => {
        const timer = setTimeout(
          () => resolve({ done: true, timedOut: true }),
          quietTimeoutMs
        );
        reader
          .read()
          .then((item) => {
            clearTimeout(timer);
            resolve(item);
          })
          .catch((error) => {
            clearTimeout(timer);
            reject(error);
          });
      });
      if (readResult.timedOut) {
        if (audioChunks.length === 0) {
          throw new Error('Timed out waiting for realtime audio chunks');
        }
        console.log('\nNo new audio for 2.5s; finishing this bounded turn.');
        reader.cancel().catch(() => {});
        break;
      }
      const { done, value } = readResult;
      if (done) break;
      if (!value) continue;

      const result = value.results[0];
      if (result?.content && result.finishReason !== 'stop') {
        transcript += result.content;
        process.stdout.write(result.content);
      }

      const audio = result?.audio;
      if (audio?.data && audio.isDelta && result?.finishReason !== 'stop') {
        const bytes = Buffer.from(audio.data, 'base64');
        audioChunks.push(bytes);
        if (!heardFirstAudio) {
          heardFirstAudio = true;
          console.log('\nReceiving audio...');
        }
        player?.write(bytes);
      }
    }
  } finally {
    clearInterval(status);
  }

  await player?.close();

  console.log('\nTranscript:', transcript || '(streamed audio only)');
  console.log(
    `Audio chunks: ${audioChunks.length}, bytes: ${audioChunks.reduce(
      (total, chunk) => total + chunk.byteLength,
      0
    )}`
  );
  if (audioChunks.length === 0) {
    return;
  }

  const wav = pcm16ToWav(Buffer.concat(audioChunks));
  const path = writeBytes(outputName, wav);
  console.log('WAV audio output:', path);
  console.log('Playing saved WAV...');
  playAudio(path);
};

const streamTranscript = async (stream: ReadableStream<AxChatResponse>) => {
  const reader = stream.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = value.results[0]?.content;
    if (text && value.results[0]?.finishReason !== 'stop') {
      process.stdout.write(text);
    }
  }

  process.stdout.write('\n');
};

const apiKey = process.env.OPENAI_APIKEY ?? process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error('Set OPENAI_APIKEY or OPENAI_API_KEY to run this example');
}

const { default: WebSocket } = await import('ws');

if (mode === 'voice') {
  console.log('Starting gpt-realtime-2 voice example...');
  const llm = ai({
    name: 'openai',
    apiKey,
    config: axAIOpenAIRealtimeDefaultConfig(),
  });
  const stream = (await llm.chat(
    {
      chatPrompt: [
        {
          role: 'user',
          content:
            'Give a short friendly spoken greeting for an Ax gpt-realtime-2 audio streaming example.',
        },
      ],
    },
    { stream: true, webSocket: WebSocket }
  )) as ReadableStream<AxChatResponse>;

  await streamAudioToSpeaker(stream, 'openai-gpt-realtime-2.wav');
} else if (mode === 'transcribe') {
  console.log('Starting gpt-realtime-whisper transcription example...');
  const llm = ai({
    name: 'openai',
    apiKey,
    config: axAIOpenAIRealtimeTranscriptionDefaultConfig(),
  });
  const audio = wavToPcm16(
    readFileSync('./src/examples/assets/presentation.wav')
  );
  console.log(
    `Streaming ./src/examples/assets/presentation.wav as PCM16 ${audio.sampleRate}Hz mono...`
  );
  const stream = (await llm.chat(
    {
      chatPrompt: [
        {
          role: 'user',
          content: [
            {
              type: 'audio',
              data: audio.data.toString('base64'),
              format: 'pcm16',
              sampleRate: audio.sampleRate,
              channels: audio.channels,
            },
          ],
        },
      ],
    },
    { stream: true, webSocket: WebSocket }
  )) as ReadableStream<AxChatResponse>;

  await streamTranscript(stream);
} else {
  throw new Error(
    'Usage: npm run tsx ./src/examples/audio-chat.ts voice|transcribe'
  );
}
