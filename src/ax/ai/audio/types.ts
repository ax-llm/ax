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
