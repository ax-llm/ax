import type { API } from '../../util/apicall.js';
import {
  AxBaseAI,
  axBaseAIDefaultConfig,
  axBaseAIDefaultCreativeConfig
} from '../base.js';
import type {
  AxAIPromptConfig,
  AxAIServiceOptions,
  AxChatRequest,
  AxChatResponse,
  AxModelConfig
} from '../types.js';

import { axModelInfoHuggingFace } from './info.js';
import {
  type AxHuggingFaceConfig,
  AxHuggingFaceModel,
  type AxHuggingFaceRequest,
  type AxHuggingFaceResponse
} from './types.js';

export const axHuggingFaceDefaultConfig = (): AxHuggingFaceConfig =>
  structuredClone({
    model: AxHuggingFaceModel.MetaLlama270BChatHF,
    ...axBaseAIDefaultConfig()
  });

export const axHuggingFaceCreativeConfig = (): AxHuggingFaceConfig =>
  structuredClone({
    model: AxHuggingFaceModel.MetaLlama270BChatHF,
    ...axBaseAIDefaultCreativeConfig()
  });

export interface AxHuggingFaceArgs {
  apiKey: string;
  config?: Readonly<AxHuggingFaceConfig>;
  options?: Readonly<AxAIServiceOptions>;
}

export class AxHuggingFace extends AxBaseAI<
  AxHuggingFaceRequest,
  unknown,
  AxHuggingFaceResponse,
  unknown,
  unknown
> {
  private config: AxHuggingFaceConfig;

  constructor({
    apiKey,
    config = axHuggingFaceDefaultConfig(),
    options
  }: Readonly<AxHuggingFaceArgs>) {
    if (!apiKey || apiKey === '') {
      throw new Error('HuggingFace API key not set');
    }
    super({
      name: 'HuggingFace',
      apiURL: 'https://api-inference.huggingface.co',
      headers: { Authorization: `Bearer ${apiKey}` },
      modelInfo: axModelInfoHuggingFace,
      models: { model: config.model },
      options,
      supportFor: { functions: false, streaming: false }
    });
    this.config = config;
  }

  override getModelConfig(): AxModelConfig {
    const { config } = this;
    return {
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      topP: config.topP,
      topK: config.topK,
      n: config.n,
      presencePenalty: config.presencePenalty
    } as AxModelConfig;
  }

  override generateChatReq = (
    req: Readonly<AxChatRequest>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _config: Readonly<AxAIPromptConfig>
  ): [API, AxHuggingFaceRequest] => {
    const model = req.modelInfo?.name ?? this.config.model;

    const functionsList = req.functions
      ? `Functions:\n${JSON.stringify(req.functions, null, 2)}\n`
      : '';

    const prompt = req.chatPrompt
      ?.map((msg) => {
        return `${msg.role}: ${msg.content}`;
      })
      .join('\n');

    const inputs = `${functionsList} ${prompt}`.trim();

    const apiConfig = {
      name: '/models'
    };

    const reqValue: AxHuggingFaceRequest = {
      model,
      inputs,
      parameters: {
        max_new_tokens: req.modelConfig?.maxTokens ?? this.config.maxTokens,
        repetition_penalty:
          req.modelConfig?.presencePenalty ?? this.config.presencePenalty,
        temperature: req.modelConfig?.temperature ?? this.config.temperature,
        top_p: req.modelConfig?.topP ?? this.config.topP,
        top_k: req.modelConfig?.topK ?? this.config.topK,
        return_full_text: this.config.returnFullText,
        num_return_sequences: this.config.n,
        do_sample: this.config.doSample,
        max_time: this.config.maxTime
      },
      options: {
        use_cache: this.config.useCache,
        wait_for_model: this.config.waitForModel
      }
    };

    return [apiConfig, reqValue];
  };

  override generateChatResp = (
    resp: Readonly<AxHuggingFaceResponse>
  ): AxChatResponse => {
    return {
      results: [
        {
          content: resp.generated_text
        }
      ]
    };
  };
}
