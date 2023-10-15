import { AIPromptConfig, AIServiceOptions } from '../../text/types.js';
import { API } from '../../util/apicall.js';
import { BaseAI } from '../base.js';
import { TextModelConfig, TextResponse } from '../types.js';

import { modelInfoHuggingFace } from './info.js';
import { generateReq } from './req.js';
import {
  apiURLHuggingFace,
  HuggingFaceApi,
  HuggingFaceModel,
  HuggingFaceOptions,
  HuggingFaceRequest,
  HuggingFaceResponse,
} from './types.js';

/**
 * HuggingFace: Default Model options for text generation
 * @export
 */
export const HuggingFaceDefaultOptions = (): HuggingFaceOptions => ({
  model: HuggingFaceModel.MetaLlama270BChatHF,
  maxNewTokens: 1000,
  temperature: 0,
  topP: 1,
});

/**
 * HuggingFace: Default model options for more creative text generation
 * @export
 */
export const HuggingFaceCreativeOptions = (): HuggingFaceOptions => ({
  ...HuggingFaceDefaultOptions(),
  model: HuggingFaceModel.MetaLlama270BChatHF,
  temperature: 0.9,
});

/**
 * HuggingFace: AI Service
 * @export
 */
export class HuggingFace extends BaseAI {
  private apiKey: string;
  private options: HuggingFaceOptions;

  constructor(
    apiKey: string,
    options: Readonly<HuggingFaceOptions> = HuggingFaceDefaultOptions(),
    otherOptions?: Readonly<AIServiceOptions>
  ) {
    super(
      'Hugging Face',
      modelInfoHuggingFace,
      {
        model: options.model,
      },
      otherOptions
    );

    if (!apiKey || apiKey === '') {
      throw new Error('Hugging Face API key not set');
    }
    this.apiKey = apiKey;
    this.options = options;
  }

  getModelConfig(): TextModelConfig {
    const { options } = this;
    return {
      maxTokens: options.maxNewTokens,
      temperature: options.temperature,
      topP: options.topP,
      topK: options.topK,
    } as TextModelConfig;
  }

  async _generate(
    prompt: string,
    options?: Readonly<AIPromptConfig>
  ): Promise<TextResponse> {
    const res = await this.apiCall<HuggingFaceRequest, HuggingFaceResponse>(
      this.createAPI(HuggingFaceApi.Completion),
      generateReq(prompt, this.options, options?.stopSequences ?? [])
    );

    return {
      results: [{ text: res.generated_text }],
    };
  }

  private createAPI(name: HuggingFaceApi): API {
    return {
      url: new URL(`${name}/${this.options.model}`, apiURLHuggingFace).href,
      key: this.apiKey,
      name,
    };
  }
}
