import { AIPromptConfig, AIServiceOptions } from '../../text/types.js';
import { AITextCompletionRequest } from '../../tracing/types.js';
import { API } from '../../util/apicall.js';
import { BaseAI } from '../base.js';
import { TextModelConfig, TextResponse } from '../types.js';

import { modelInfoHuggingFace } from './info.js';
import {
  HuggingFaceModel,
  HuggingFaceOptions,
  HuggingFaceRequest,
  HuggingFaceResponse
} from './types.js';

/**
 * HuggingFace: Default Model options for text generation
 * @export
 */
export const HuggingFaceDefaultOptions = (): HuggingFaceOptions => ({
  model: HuggingFaceModel.MetaLlama270BChatHF,
  maxNewTokens: 500,
  temperature: 0,
  topP: 1
});

/**
 * HuggingFace: Default model options for more creative text generation
 * @export
 */
export const HuggingFaceCreativeOptions = (): HuggingFaceOptions => ({
  ...HuggingFaceDefaultOptions(),
  model: HuggingFaceModel.MetaLlama270BChatHF,
  temperature: 0.9
});

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
  private options: HuggingFaceOptions;

  constructor(
    apiKey: string,
    options: Readonly<HuggingFaceOptions> = HuggingFaceDefaultOptions(),
    otherOptions?: Readonly<AIServiceOptions>
  ) {
    if (!apiKey || apiKey === '') {
      throw new Error('HuggingFace API key not set');
    }
    super(
      'HuggingFace',
      'https://api-inference.huggingface.co',
      { Authorization: `Bearer ${apiKey}` },
      modelInfoHuggingFace,
      { model: options.model },
      otherOptions
    );
    this.options = options;
  }

  override getModelConfig(): TextModelConfig {
    const { options } = this;
    return {
      maxTokens: options.maxNewTokens,
      temperature: options.temperature,
      topP: options.topP,
      topK: options.topK,
      n: options.numReturnSequences,
      presencePenalty: options.repetitionPenalty
    } as TextModelConfig;
  }

  generateCompletionReq = (
    req: Readonly<AITextCompletionRequest>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _config: Readonly<AIPromptConfig>
  ): [API, HuggingFaceRequest] => {
    const model = req.modelInfo?.name ?? this.options.model;
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
        max_new_tokens: req.modelConfig?.maxTokens ?? this.options.maxNewTokens,
        repetition_penalty:
          req.modelConfig?.presencePenalty ?? this.options.repetitionPenalty,
        temperature: req.modelConfig?.temperature ?? this.options.temperature,
        top_p: req.modelConfig?.topP ?? this.options.topP,
        top_k: req.modelConfig?.topK ?? this.options.topK,
        return_full_text: this.options.returnFullText,
        num_return_sequences: this.options.numReturnSequences,
        do_sample: this.options.doSample,
        max_time: this.options.maxTime
      },
      options: {
        use_cache: this.options.useCache,
        wait_for_model: this.options.waitForModel
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
          text: resp.generated_text
        }
      ]
    };
  };
}
