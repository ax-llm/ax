import type { AxChatAudioConfig } from './types.js';

export const axOpenAIChatAudioDefaults = (): AxChatAudioConfig => ({
  output: {
    enabled: true,
    voice: 'alloy',
    format: 'wav',
    includeTranscript: true,
  },
});

export const axGoogleGeminiLiveAudioDefaults = (): AxChatAudioConfig => ({
  input: {
    format: 'pcm16',
    mimeType: 'audio/pcm;rate=16000',
    sampleRate: 16000,
    channels: 1,
  },
  output: {
    enabled: true,
    voice: 'Kore',
    format: 'pcm16',
    mimeType: 'audio/pcm;rate=24000',
    sampleRate: 24000,
    channels: 1,
    includeTranscript: true,
  },
  live: {
    turnTimeoutMs: 30_000,
  },
});

export const axMergeChatAudioConfig = (
  base?: Readonly<AxChatAudioConfig>,
  override?: Readonly<AxChatAudioConfig>
): AxChatAudioConfig | undefined => {
  if (!base && !override) {
    return undefined;
  }

  return {
    input:
      base?.input || override?.input
        ? { ...base?.input, ...override?.input }
        : undefined,
    output:
      base?.output || override?.output
        ? { ...base?.output, ...override?.output }
        : undefined,
    live:
      base?.live || override?.live
        ? { ...base?.live, ...override?.live }
        : undefined,
  };
};

export const axIsAudioOutputEnabled = (
  audio?: Readonly<AxChatAudioConfig>
): boolean => audio?.output?.enabled === true;
