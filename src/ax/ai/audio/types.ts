export type AxAudioFormat =
  | 'wav'
  | 'mp3'
  | 'flac'
  | 'opus'
  | 'aac'
  | 'pcm16'
  | 'pcm'
  | 'raw'
  | 'mulaw'
  | 'ulaw'
  | 'alaw'
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

export type AxAudioInput = {
  data: string;
  format?: AxAudioFormat;
  mimeType?: string;
  filename?: string;
  sampleRate?: number;
  channels?: number;
};

export type AxTranscriptionRequest<TModel = string> = {
  audio: AxAudioInput;
  model?: TModel;
  language?: string;
  prompt?: string;
  temperature?: number;
  responseFormat?: 'json' | 'verbose_json' | 'text';
  /** Portable speech-turn behavior for providers that support it. */
  mode?: 'push_to_talk' | 'endpointing' | 'diarization';
  /** Expected spoken languages used to bias recognition without forcing one language. */
  languageBias?: string[];
  /** Domain words and names used to bias recognition. */
  keywords?: string[];
  /** Shape of partial transcript events when a provider offers streaming transcription. */
  partialMode?: 'cumulative' | 'delta';
  /** Ask the provider to emit audio processing progress when supported. */
  emitAudioProgress?: boolean;
  /** Optional caller correlation identifier. */
  sessionId?: string;
};

export type AxTranscriptionSegment = {
  id?: number | string;
  text: string;
  start?: number;
  end?: number;
  speaker?: string | number;
};

export type AxTranscriptionResponse = {
  text: string;
  language?: string;
  duration?: number;
  segments?: AxTranscriptionSegment[];
  words?: AxTranscriptionSegment[];
  sessionId?: string;
  /** Latest provider-reported amount of audio processed. */
  audioProcessedMs?: number;
};

export type AxSpeechRequest<TModel = string> = {
  text: string;
  model?: TModel;
  voice?: string | { id: string };
  format?: AxAudioFormat;
  mimeType?: string;
  sampleRate?: number;
  speed?: number;
  language?: string;
};

export type AxSpeechResponse = AxChatAudioOutput;

export type AxSpeechConfig = {
  transcribe?: Omit<AxTranscriptionRequest, 'audio'>;
  speak?: Omit<AxSpeechRequest, 'text'>;
  fields?: Record<string, Omit<AxSpeechRequest, 'text'>>;
};
