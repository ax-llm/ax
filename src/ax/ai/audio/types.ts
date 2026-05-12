export type AxAudioFormat =
  | 'wav'
  | 'mp3'
  | 'flac'
  | 'opus'
  | 'aac'
  | 'pcm16'
  | 'pcm'
  | 'ogg';

export type AxChatAudioConfig = {
  input?: {
    format?: AxAudioFormat;
    mimeType?: string;
    sampleRate?: number;
    channels?: number;
  };
  output?: {
    enabled?: boolean;
    voice?: string | { id: string };
    format?: AxAudioFormat;
    mimeType?: string;
    sampleRate?: number;
    channels?: number;
    includeTranscript?: boolean;
  };
  live?: {
    turnTimeoutMs?: number;
    enableAffectiveDialog?: boolean;
    proactiveAudio?: boolean;
  };
};

export type AxChatAudioOutput = {
  data: string;
  id?: string;
  mimeType?: string;
  format?: AxAudioFormat;
  transcript?: string;
  expiresAt?: number;
  sampleRate?: number;
  channels?: number;
  isDelta?: boolean;
};
