import type { AIPromptConfig, AIServiceOptions } from '../../text/types.js';
import type { AITextCompletionRequest } from '../../tracing/types.js';
import type { API } from '../../util/apicall.js';
import { BaseAI } from '../base.js';
import type { TextModelConfig, TextResponse } from '../types.js';

import { modelInfoHuggingFace } from './info.js';
import {
  type HuggingFaceConfig,
  HuggingFaceModel,
  type HuggingFaceRequest,
  type HuggingFaceResponse
} from './types.js';

/**
 * HuggingFace: Default Model options for text generation
 * @export
 */
export const HuggingFaceDefaultOptions = (): HuggingFaceConfig => ({
  model: HuggingFaceModel.MetaLlama270BChatHF,
  maxNewTokens: 500,
  temperature: 0,
  topP: 1
});

/**
 * HuggingFace: Default model options for more creative text generation
 * @export
 */
export const HuggingFaceCreativeOptions = (): HuggingFaceConfig => ({
  ...HuggingFaceDefaultOptions(),
  model: HuggingFaceModel.MetaLlama270BChatHF,
  temperature: 0.9
});

export interface HuggingFaceArgs {
  apiKey: string;
  config?: Readonly<HuggingFaceConfig>;
  options?: Readonly<AIServiceOptions>;
}

/**
 * HuggingFace: AI Service
 * @export
 */
export class HuggingFace extends BaseAI<
  HuggingFaceRequest,
  unknown,
  unknown,
  HuggingFaceResponse,
  unknown,
  unknown,
  unknown,
  unknown
> {
  private config: HuggingFaceConfig;

  constructor({
    apiKey,
    config = HuggingFaceDefaultOptions(),
    options
  }: Readonly<HuggingFaceArgs>) {
    if (!apiKey || apiKey === '') {
      throw new Error('HuggingFace API key not set');
    }
    super({
      name: 'HuggingFace',
      apiURL: 'https://api-inference.huggingface.co',
      headers: { Authorization: `Bearer ${apiKey}` },
      modelInfo: modelInfoHuggingFace,
      models: { model: config.model },
      options,
      supportFor: { functions: false }
    });
    this.config = config;
  }

  override getModelConfig(): TextModelConfig {
    const { config } = this;
    return {
      maxTokens: config.maxNewTokens,
      temperature: config.temperature,
      topP: config.topP,
      topK: config.topK,
      n: config.numReturnSequences,
      presencePenalty: config.repetitionPenalty
    } as TextModelConfig;
  }

  generateCompletionReq = (
    req: Readonly<AITextCompletionRequest>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _config: Readonly<AIPromptConfig>
  ): [API, HuggingFaceRequest] => {
    const model = req.modelInfo?.name ?? this.config.model;
    const functionsList = req.functions
      ? `Functions:\n${JSON.stringify(req.functions, null, 2)}\n`
      : '';
    const inputs = `${functionsList} ${req.systemPrompt || ''} ${
      req.prompt || ''
    }`.trim();

    const apiConfig = {
      name: '/models'
    };

    const reqValue: HuggingFaceRequest = {
      model,
      inputs,
      parameters: {
        max_new_tokens: req.modelConfig?.maxTokens ?? this.config.maxNewTokens,
        repetition_penalty:
          req.modelConfig?.presencePenalty ?? this.config.repetitionPenalty,
        temperature: req.modelConfig?.temperature ?? this.config.temperature,
        top_p: req.modelConfig?.topP ?? this.config.topP,
        top_k: req.modelConfig?.topK ?? this.config.topK,
        return_full_text: this.config.returnFullText,
        num_return_sequences: this.config.numReturnSequences,
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

  generateCompletionResp = (
    resp: Readonly<HuggingFaceResponse>
  ): TextResponse => {
    return {
      results: [
        {
          content: resp.generated_text
        }
      ]
    };
  };
}
