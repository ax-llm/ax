import type { AxModelConfig, AxServiceTier } from '../types.js';

export enum AxAIOpenAIModel {
  // Non-reasoning models
  GPT4 = 'gpt-4',
  GPT41 = 'gpt-4.1',
  GPT41Mini = 'gpt-4.1-mini',
  GPT41Nano = 'gpt-4.1-nano',
  GPT4O = 'gpt-4o',
  GPT4OMini = 'gpt-4o-mini',
  GPTAudio = 'gpt-audio',
  GPTAudioMini = 'gpt-audio-mini',
  GPTAudio15 = 'gpt-audio-1.5',
  GPTRealtime15 = 'gpt-realtime-1.5',
  GPTRealtime2 = 'gpt-realtime-2',
  GPTRealtimeWhisper = 'gpt-realtime-whisper',
  GPTRealtimeTranslate = 'gpt-realtime-translate',
  GPT4ChatGPT4O = 'chatgpt-4o-latest',
  GPT4Turbo = 'gpt-4-turbo',
  GPT35Turbo = 'gpt-3.5-turbo',
  GPT35TurboInstruct = 'gpt-3.5-turbo-instruct',
  GPT35TextDavinci002 = 'text-davinci-002',
  GPT3TextBabbage002 = 'text-babbage-002',
  GPT3TextAda001 = 'text-ada-001',
  // GPT-5 models
  GPT5 = 'gpt-5',
  GPT5Nano = 'gpt-5-nano',
  GPT5Mini = 'gpt-5-mini',
  GPT5Chat = 'gpt-5-chat',
  GPT5ChatLatest = 'gpt-5-chat-latest',
  GPT5Codex = 'gpt-5-codex',
  GPT5Pro = 'gpt-5-pro',
  GPT51 = 'gpt-5.1',
  GPT51ChatLatest = 'gpt-5.1-chat-latest',
  GPT51Codex = 'gpt-5.1-codex',
  GPT51CodexMini = 'gpt-5.1-codex-mini',
  GPT51CodexMax = 'gpt-5.1-codex-max',
  GPT52 = 'gpt-5.2',
  GPT52ChatLatest = 'gpt-5.2-chat-latest',
  GPT52Codex = 'gpt-5.2-codex',
  GPT52Pro = 'gpt-5.2-pro',
  // GPT-5.4 models
  GPT54 = 'gpt-5.4',
  GPT54Mini = 'gpt-5.4-mini',
  GPT54Nano = 'gpt-5.4-nano',
  // GPT-5.5 models
  GPT55 = 'gpt-5.5',
  GPT55Pro = 'gpt-5.5-pro',
  // GPT-5.6 models. `gpt-5.6` is an alias OpenAI routes to `gpt-5.6-sol`.
  GPT56 = 'gpt-5.6',
  GPT56Sol = 'gpt-5.6-sol',
  GPT56Terra = 'gpt-5.6-terra',
  GPT56Luna = 'gpt-5.6-luna',
  // Reasoning models
  O1 = 'o1',
  O1Mini = 'o1-mini',
  O3 = 'o3',
  O3Mini = 'o3-mini',
  O4Mini = 'o4-mini',
}

export enum AxAIOpenAIEmbedModel {
  TextEmbeddingAda002 = 'text-embedding-ada-002',
  TextEmbedding3Small = 'text-embedding-3-small',
  TextEmbedding3Large = 'text-embedding-3-large',
}

// Web search annotation types
export type AxAIOpenAIUrlCitation = {
  url: string;
  title?: string;
  description?: string;
};

export type AxAIOpenAIAnnotation = {
  type: 'url_citation';
  url_citation: AxAIOpenAIUrlCitation;
};

export type AxAIOpenAIConfig<TModel, TEmbedModel> = Omit<
  AxModelConfig,
  'topK'
> & {
  model: TModel;
  embedModel?: TEmbedModel;
  user?: string;
  responseFormat?: 'json_object';
  bestOf?: number;
  logitBias?: Map<string, number>;
  suffix?: string | null;
  stop?: string[];
  logprobs?: number;
  echo?: boolean;
  dimensions?: number;
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  store?: boolean;
  /** Portable values plus the legacy OpenAI `default` alias. */
  serviceTier?: AxServiceTier | 'default';
  webSearchOptions?: {
    searchContextSize?: 'low' | 'medium' | 'high';
    userLocation?: {
      approximate: {
        type: 'approximate';
        city?: string;
        country?: string;
        region?: string;
        timezone?: string;
      };
    } | null;
  };
};

export type AxAIOpenAILogprob = {
  tokens: string[];
  token_logprobs: number[];
  top_logprobs: Map<string, number>;
  text_offset: number[];
};

export type AxAIOpenAIUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  service_tier?: string;
  prompt_tokens_details?: {
    cached_tokens?: number;
    /**
     * Prompt tokens written to the cache on this request, billed at a premium
     * over uncached input. Sits alongside `cached_tokens`, and `prompt_tokens`
     * includes both — see usage.ts, which subtracts them back out.
     */
    cache_write_tokens?: number;
  };
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
};

/**
 * Marks a cache breakpoint on the content block that carries it. The marker is
 * part of the block, so moving it between requests changes the serialized
 * prefix and voids the entry it wrote — see caching.ts.
 */
export type AxAIOpenAIPromptCacheBreakpoint = { mode: 'explicit' };

/**
 * A content block in a Chat Completions message. Chat Completions accepts a
 * `prompt_cache_breakpoint` on `text`, `image_url`, `input_audio`, `file` and
 * `refusal` blocks; Ax never emits `refusal` on a request, so it is absent here.
 */
export type AxAIOpenAIChatContentPart = (
  | {
      type: string;
      text: string;
    }
  | {
      type: 'image_url';
      image_url: { url: string; details?: 'high' | 'low' | 'auto' };
    }
  | {
      type: 'input_audio';
      input_audio: {
        data: string;
        format: 'wav' | 'mp3' | 'pcm16';
        mimeType?: string;
        sampleRate?: number;
        channels?: number;
      };
    }
  | {
      type: 'file';
      file: {
        file_data: string;
        filename: string;
      };
    }
) & {
  prompt_cache_breakpoint?: AxAIOpenAIPromptCacheBreakpoint;
};

export interface AxAIOpenAIResponseDelta<T> {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    delta: T;
    finish_reason?: 'stop' | 'length' | 'content_filter' | 'tool_calls' | null;
  }[];
  usage?: AxAIOpenAIUsage;
  service_tier?: string;
  service_tier_used?: string;
  system_fingerprint: string;
}

export type AxAIOpenAIChatRequest<TModel> = {
  model: TModel;
  service_tier?: string;
  // `max` is absent on purpose: Chat Completions rejects it even on the models
  // whose Responses endpoint serves it. See effort.ts for the ladders.
  reasoning_effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  /**
   * Stable per-conversation key that routes the request to the shard its cache
   * lives on. GPT-5.6+ requires it for reliable matching; earlier families
   * predate it and reject it with a 400.
   */
  prompt_cache_key?: string;
  /**
   * `implicit` (the default) also places a breakpoint at the newest user or tool
   * message; `explicit` uses only caller-provided breakpoints.
   */
  prompt_cache_options?: { mode?: 'implicit' | 'explicit' };
  store?: boolean;
  modalities?: readonly ('text' | 'audio')[];
  audio?: {
    format: 'wav' | 'mp3' | 'flac' | 'opus' | 'aac' | 'pcm16';
    voice: string | { id: string };
  };
  messages: (
    | { role: 'system'; content: string | AxAIOpenAIChatContentPart[] }
    | {
        role: 'user';
        content: string | AxAIOpenAIChatContentPart[];
        name?: string;
      }
    | {
        role: 'assistant';
        content?:
          | string
          | {
              type: string;
              text: string;
            }
          | AxAIOpenAIChatContentPart[];
        name?: string;
        reasoning_content?: string;
        audio?: { id: string };
      }
    | {
        role: 'assistant';
        content?:
          | string
          | {
              type: string;
              text: string;
            }
          | AxAIOpenAIChatContentPart[];
        name?: string;
        reasoning_content?: string;
        tool_calls: {
          type: 'function';
          function: {
            name: string;
            // eslint-disable-next-line functional/functional-parameters
            arguments?: string;
          };
        }[];
      }
    | {
        role: 'tool';
        content: string | AxAIOpenAIChatContentPart[];
        tool_call_id: string;
      }
  )[];
  tools?: {
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters?: object;
    };
  }[];
  tool_choice?:
    | 'none'
    | 'auto'
    | 'required'
    | { type: 'function'; function: { name: string } };
  response_format?:
    | { type: string }
    | { type: 'json_schema'; json_schema: any };
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  n?: number;
  stream?: boolean;
  stop?: readonly string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  logit_bias?: Map<string, number>;
  user?: string;
  organization?: string;
  web_search_options?: {
    search_context_size?: 'low' | 'medium' | 'high';
    user_location?: {
      approximate: {
        type: 'approximate';
        city?: string;
        country?: string;
        region?: string;
        timezone?: string;
      };
    } | null;
  };
};

export type AxAIOpenAIChatResponse = {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  service_tier?: string;
  service_tier_used?: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string | null;
      refusal: string | null;
      audio?: {
        id: string;
        data?: string;
        expires_at?: number;
        transcript?: string;
      } | null;
      reasoning_content?: string;
      annotations?: AxAIOpenAIAnnotation[];
      tool_calls?: {
        id: string;
        type: 'function';
        // eslint-disable-next-line functional/functional-parameters
        function: { name: string; arguments: string };
      }[];
    };
    finish_reason: 'stop' | 'length' | 'content_filter' | 'tool_calls';
  }[];
  usage?: AxAIOpenAIUsage;
  error?: {
    message: string;
    type: string;
    param: string;
    code: number;
  };
  system_fingerprint: string;
};

export type AxAIOpenAIChatResponseDelta = AxAIOpenAIResponseDelta<{
  content: string | null;
  refusal?: string | null;
  audio?: {
    id?: string;
    data?: string;
    delta?: string;
    expires_at?: number;
    transcript?: string;
  } | null;
  reasoning_content?: string;
  role?: string;
  annotations?: AxAIOpenAIAnnotation[];
  tool_calls?: (NonNullable<
    AxAIOpenAIChatResponse['choices'][0]['message']['tool_calls']
  >[0] & {
    index: number;
  })[];
}>;

export type AxAIOpenAIEmbedRequest<TEmbedModel> = {
  input: readonly string[];
  model: TEmbedModel;
  dimensions?: number;
  user?: string;
};

export type AxAIOpenAIEmbedResponse = {
  model: string;
  data: {
    embedding: readonly number[];
    index: number;
  }[];
  usage: AxAIOpenAIUsage;
};
