import {
  AIService,
  GenerateResponse,
  EmbedResponse,
  PromptMetadata,
} from '../text';

import { API, apiCall } from './util';

const apiURL = 'https://api.aleph-alpha.com/';

const enum apiTypes {
  Generate = 'complete',
  Embed = 'semantic_embed',
}

/**
 * AlephAlpha: Models for text generation
 * @export
 */
export const enum AlephAlphaGenerateModels {
  LuminousSupremeControl = 'luminous-supreme-control',
  LuminousSupreme = 'luminous-supreme',
  LuminousExtended = 'luminous-extended',
  LuminousBase = 'luminous-base',
}

export const enum AlephAlphaEmbedRepresentation {
  Symmetric = 'symmetric',
  Document = 'document',
  Query = 'query',
}

export const enum AlephaAlphaGenerateHosting {
  MaxPrivacy = 'aleph-alpha',
}

/**
 * AlephAlpha: Model options for text generation
 * @export
 */
export type AlephAlphaTextOptions = {
  model: AlephAlphaGenerateModels | string;
  hosting?: AlephaAlphaGenerateHosting;
  maxTokens: number;
  minTokens?: number;
  echo?: boolean;
  temperature: number;
  topK: number;
  topP: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  sequencePenalty?: number;
  sequencePenaltyMinLength?: number;
  repetitionPenaltiesIncludeCompletion?: number;
  useMultiplicativePresencePenalty?: boolean;
  useMultiplicativeFrequencyPenalty?: boolean;
  useMultiplicativeSequencePenalty?: boolean;
  penaltyBias?: string;
  penaltyExceptions?: string[];
  penaltyExceptionsIncludeStopSequences?: boolean;
  bestOf?: number;
  n?: number;
  logitBias?: Map<string, number>;
  logProbs?: number;
  tokens?: boolean;
  rawCompletion?: boolean;
  disableOptimizations?: boolean;
  completionBiasInclusion?: string[];
  completionBiasInclusionFirstTokenOnly?: boolean;
  completionBiasExclusion?: boolean;
  completionBiasExclusionFirstTokenOnly?: boolean;
  contextualControlThreshold?: number;
  controlLogAdditive?: boolean;
  representation: AlephAlphaEmbedRepresentation;
  compressToSize?: number;
  normalize?: boolean;
};

/**
 * AlephAlpha: Default Model options for text generation
 * @export
 */
export const AlephAlphaDefaultTextOptions = (): AlephAlphaTextOptions => ({
  model: AlephAlphaGenerateModels.LuminousSupreme,
  representation: AlephAlphaEmbedRepresentation.Document,
  disableOptimizations: true,
  maxTokens: 300,
  temperature: 0.45,
  topK: 0,
  topP: 1,
  //frequencyPenalty: 0.40
  // presencePenalty: 0.40
});

/**
 * AlephAlpha: Default model options for more creative text generation
 * @export
 */
export const AlephAlphaCreativeTextOptions = (): AlephAlphaTextOptions => ({
  ...AlephAlphaDefaultTextOptions(),
  model: AlephAlphaGenerateModels.LuminousSupreme,
  temperature: 0.9,
});

type AlephAlphaGenerateRequest = {
  model: AlephAlphaGenerateModels | string;
  hosting?: AlephaAlphaGenerateHosting;
  prompt: string;
  maximum_tokens: number;
  minimum_tokens?: number;
  echo?: boolean;
  temperature: number;
  top_k: number;
  top_p: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  sequence_penalty?: number;
  sequence_penalty_min_length?: number;
  repetition_penalties_include_completion?: number;
  use_multiplicative_presence_penalty?: boolean;
  useMultiplicativeFrequencyPenalty?: boolean;
  useMultiplicativeSequencePenalty?: boolean;
  penalty_bias?: string;
  penalty_exceptions?: string[];
  penalty_exceptions_include_stop_sequences?: boolean;
  best_of?: number;
  n?: number;
  logit_bias?: Map<string, number>;
  log_probs?: number;
  stop_sequences: string[];
  tokens?: boolean;
  raw_completion?: boolean;
  disable_optimizations?: boolean;
  completion_bias_inclusion?: string[];
  completion_bias_inclusion_first_token_only?: boolean;
  completion_bias_exclusion?: boolean;
  completion_bias_exclusion_first_token_only?: boolean;
  contextual_control_threshold?: number;
  control_log_additive?: boolean;
};

type AlephAlphaGenerateResponse = {
  model_version: string;
  completions: [
    {
      log_probs: Map<string, number>;
      completion: string;
      raw_completion: string;
      completion_tokens: string[];
      finish_reason: string;
    }
  ];
  optimized_prompt: [{ type: string; data: string }];
};

type AlephAlphaEmbedRequest = {
  model: AlephAlphaGenerateModels | string;
  hosting?: AlephaAlphaGenerateHosting;
  prompt: string;
  representation: AlephAlphaEmbedRepresentation;
  compress_to_size?: number;
  normalize?: boolean;
  contextual_control_threshold?: number;
  control_log_additive?: boolean;
};

type AlephAlphaEmbedResponse = {
  model_version: string;
  embedding: number[];
};

const generateReq = (
  prompt: string,
  stopSequences: string[] = [],
  opt: Readonly<AlephAlphaTextOptions>
): AlephAlphaGenerateRequest => ({
  model: opt.model,
  hosting: opt.hosting,
  prompt: prompt,
  maximum_tokens: opt.maxTokens,
  minimum_tokens: opt.minTokens,
  echo: opt.echo,
  temperature: opt.temperature,
  top_k: opt.topK,
  top_p: opt.topP,
  presence_penalty: opt.presencePenalty,
  frequency_penalty: opt.frequencyPenalty,
  sequence_penalty: opt.sequencePenalty,
  sequence_penalty_min_length: opt.sequencePenaltyMinLength,
  repetition_penalties_include_completion:
    opt.repetitionPenaltiesIncludeCompletion,
  use_multiplicative_presence_penalty: opt.useMultiplicativePresencePenalty,
  useMultiplicativeFrequencyPenalty: opt.useMultiplicativeFrequencyPenalty,
  useMultiplicativeSequencePenalty: opt.useMultiplicativeSequencePenalty,
  penalty_bias: opt.penaltyBias,
  penalty_exceptions: opt.penaltyExceptions,
  penalty_exceptions_include_stop_sequences:
    opt.penaltyExceptionsIncludeStopSequences,
  best_of: opt.bestOf,
  n: opt.n,
  logit_bias: opt.logitBias,
  log_probs: opt.logProbs,
  stop_sequences: stopSequences,
  tokens: opt.tokens,
  raw_completion: opt.rawCompletion,
  disable_optimizations: opt.disableOptimizations,
  completion_bias_inclusion: opt.completionBiasInclusion,
  completion_bias_inclusion_first_token_only:
    opt.completionBiasInclusionFirstTokenOnly,
  completion_bias_exclusion: opt.completionBiasExclusion,
  completion_bias_exclusion_first_token_only:
    opt.completionBiasExclusionFirstTokenOnly,
  contextual_control_threshold: opt.contextualControlThreshold,
  control_log_additive: opt.controlLogAdditive,
});

const embedReq = (
  prompt: string,
  opt: Readonly<AlephAlphaTextOptions>
): AlephAlphaEmbedRequest => ({
  model: opt.model,
  hosting: opt.hosting,
  prompt: prompt,
  representation: opt.representation,
  compress_to_size: opt.compressToSize,
  normalize: opt.normalize,
  contextual_control_threshold: opt.contextualControlThreshold,
  control_log_additive: opt.controlLogAdditive,
});

/**
 * AlephAlpha: Various options that can be set on the AI Service
 * @export
 */
export type AlephAlphaOptions = {
  TextOptions?: AlephAlphaTextOptions;
};

/**
 * AlephAlpha: AI Service
 * @export
 */
export class AlephAlpha implements AIService {
  private apiKey: string;
  private TextOptions: AlephAlphaTextOptions = AlephAlphaDefaultTextOptions();

  constructor(apiKey: string, options?: Readonly<AlephAlphaOptions>) {
    if (apiKey === '') {
      throw new Error('AlephAlpha API key not set');
    }
    this.apiKey = apiKey;

    if (options?.TextOptions) {
      this.TextOptions = options.TextOptions;
    }
  }

  name(): string {
    return 'AlephAlpha';
  }

  generate(
    prompt: string,
    md?: PromptMetadata,
    sessionID?: string
  ): Promise<GenerateResponse> {
    const text = prompt.trim();

    const res = apiCall<
      API,
      AlephAlphaGenerateRequest,
      AlephAlphaGenerateResponse
    >(
      {
        key: this.apiKey,
        name: apiTypes.Generate,
        url: apiURL,
      },
      generateReq(text, md?.stopSequences, this.TextOptions)
    );

    return res.then(({ data: { completions } }) => ({
      id: '',
      sessionID: sessionID,
      query: prompt,
      values: completions.map((v) => ({ id: '', text: v.completion.trim() })),
      value() {
        return this.values[0].text;
      },
    }));
  }

  embed(texts: string[], sessionID?: string): Promise<EmbedResponse> {
    if (texts.length > 1) {
      throw new Error('AlephAlpha limits embeddings input to 1 string');
    }

    const overLimit = texts.filter((v) => v.length > 512);
    if (overLimit.length !== 0) {
      throw new Error('AlephAlpha limits embeddings input to 512 characters');
    }

    const res = apiCall<API, AlephAlphaEmbedRequest, AlephAlphaEmbedResponse>(
      {
        key: this.apiKey,
        name: apiTypes.Embed,
        url: apiURL,
      },
      embedReq(texts[0], this.TextOptions)
    );

    return res.then(({ data: { model_version, embedding } }) => ({
      id: '',
      sessionID,
      texts,
      model: model_version,
      embeddings: embedding,
    }));
  }
}
