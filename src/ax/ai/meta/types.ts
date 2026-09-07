import type { AxAIAnthropicConfig } from '../anthropic/types.js';
import type { AxAIOpenAIArgs } from '../openai/api.js';
import type { AxAIOpenAIConfig } from '../openai/chat_types.js';
import type { AxAIOpenAIResponsesArgs } from '../openai/responses_api_base.js';
import type { AxAIOpenAIResponsesConfig } from '../openai/responses_types.js';
import type {
  AxAICredentialProvider,
  AxAIInputModelList,
  AxAIServiceOptions,
  AxModelInfo,
} from '../types.js';

export enum AxAIMetaModel {
  MuseSpark13 = 'muse-spark-1.3',
  MuseSpark13Contributor = 'muse-spark-1.3-contributor',
  MuseSpark12 = 'muse-spark-1.2',
  MuseSpark12Contributor = 'muse-spark-1.2-contributor',
  MuseSpark11 = 'muse-spark-1.1',
  MuseImage10 = 'muse-image-1.0',
  MuseVoiceTranscribe10 = 'muse-voice-transcribe-1.0',
}

export type AxAIMetaSparkModel =
  | AxAIMetaModel.MuseSpark13
  | AxAIMetaModel.MuseSpark13Contributor
  | AxAIMetaModel.MuseSpark12
  | AxAIMetaModel.MuseSpark12Contributor
  | AxAIMetaModel.MuseSpark11;

export type AxAIMetaResponsesConfig = Omit<
  AxAIOpenAIResponsesConfig<AxAIMetaModel, never>,
  'promptCaching' | 'defaultImageOutputFormat'
>;

export type AxAIMetaChatConfig = AxAIOpenAIConfig<AxAIMetaSparkModel, never>;

export type AxAIMetaMessagesConfig = Omit<AxAIAnthropicConfig, 'model'> & {
  model: AxAIMetaSparkModel;
};

export type AxAIMetaResponsesArgs<TModelKey = string> = Omit<
  AxAIOpenAIResponsesArgs<'meta', AxAIMetaModel, never, TModelKey>,
  'config'
> & { config?: Readonly<Partial<AxAIMetaResponsesConfig>> };

export type AxAIMetaChatArgs<TModelKey = string> = AxAIOpenAIArgs<
  'meta-chat',
  AxAIMetaSparkModel,
  never,
  TModelKey
>;

export interface AxAIMetaMessagesArgs<TModelKey = string> {
  name: 'meta-messages';
  apiKey?: string;
  credentialProvider?: AxAICredentialProvider;
  apiURL?: string;
  config?: Readonly<Partial<AxAIMetaMessagesConfig>>;
  options?: Readonly<AxAIServiceOptions>;
  modelInfo?: AxModelInfo[];
  models?: AxAIInputModelList<AxAIMetaSparkModel, undefined, TModelKey>;
}

export type AxAIMetaArgs<TModelKey = string> =
  | AxAIMetaResponsesArgs<TModelKey>
  | AxAIMetaChatArgs<TModelKey>
  | AxAIMetaMessagesArgs<TModelKey>;
