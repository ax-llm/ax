import { getModelInfo } from '../../dsp/modelinfo.js';
import type { AxAIFeatures } from '../base.js';
import {
  type AxAIOpenAIResponsesArgs,
  AxAIOpenAIResponsesBase,
} from '../openai/responses_api_base.js';
import type {
  AxAIOpenAIResponsesConfig,
  AxAIOpenAIResponsesRequest,
} from '../openai/responses_types.js';
import type { AxModelInfo } from '../types.js';
import { axModelInfoDeepSeek } from './info.js';
import { AxAIDeepSeekModel } from './types.js';

type DeepSeekResponsesConfig = AxAIOpenAIResponsesConfig<
  AxAIDeepSeekModel,
  never
>;

type DeepSeekResponsesRequest = AxAIOpenAIResponsesRequest<AxAIDeepSeekModel>;

const axAIDeepSeekResponsesSupportFor = (
  model: AxAIDeepSeekModel,
  modelInfo: readonly AxModelInfo[]
): AxAIFeatures => {
  const info = getModelInfo<AxAIDeepSeekModel, never, string>({
    model,
    modelInfo,
  });

  return {
    functions: true,
    streaming: true,
    hasThinkingBudget: info?.supported?.thinkingBudget ?? true,
    hasShowThoughts: info?.supported?.showThoughts ?? true,
    structuredOutputs: info?.supported?.structuredOutputs ?? true,
    media: {
      images: { supported: false, formats: [] },
      audio: {
        supported: false,
        formats: [],
        output: { supported: false, formats: [] },
      },
      files: { supported: false, formats: [], uploadMethod: 'none' },
      urls: { supported: false, webSearch: false, contextFetching: false },
    },
    caching: { supported: false, types: [] },
    thinking: true,
    multiTurn: true,
  };
};

// DeepSeek Responses is stateless. These fields are accepted by the shared
// OpenAI mapper for OpenAI itself, but DeepSeek documents them as unsupported.
const axAIDeepSeekResponsesReqUpdater = (
  req: Readonly<DeepSeekResponsesRequest>
): DeepSeekResponsesRequest => {
  const next = { ...req } as {
    -readonly [K in keyof DeepSeekResponsesRequest]?: DeepSeekResponsesRequest[K];
  };
  delete next.include;
  delete next.previous_response_id;
  delete next.store;
  delete next.parallel_tool_calls;
  if (next.reasoning) {
    next.reasoning = next.reasoning.effort
      ? { effort: next.reasoning.effort }
      : undefined;
  }
  return next as DeepSeekResponsesRequest;
};

export const axAIDeepSeekResponsesDefaultConfig = (): DeepSeekResponsesConfig =>
  structuredClone({
    model: AxAIDeepSeekModel.DeepSeekV4Flash,
    stream: true,
  });

export type AxAIDeepSeekResponsesArgs<TModelKey = string> =
  AxAIOpenAIResponsesArgs<
    'deepseek-responses',
    AxAIDeepSeekModel,
    never,
    TModelKey,
    DeepSeekResponsesRequest
  >;

export class AxAIDeepSeekResponses<
  TModelKey = string,
> extends AxAIOpenAIResponsesBase<
  AxAIDeepSeekModel,
  never,
  TModelKey,
  DeepSeekResponsesRequest
> {
  constructor({
    apiKey,
    config,
    options,
    models,
    modelInfo,
  }: Readonly<Omit<AxAIDeepSeekResponsesArgs<TModelKey>, 'name'>>) {
    if (!apiKey || apiKey === '') {
      throw new Error('DeepSeek API key not set');
    }

    const mergedModelInfo = [...axModelInfoDeepSeek, ...(modelInfo ?? [])];
    const supportFor = (model: AxAIDeepSeekModel) =>
      axAIDeepSeekResponsesSupportFor(model, mergedModelInfo);

    super({
      apiKey,
      config: {
        ...axAIDeepSeekResponsesDefaultConfig(),
        ...config,
      },
      options,
      apiURL: 'https://api.deepseek.com',
      modelInfo: mergedModelInfo,
      models,
      responsesReqUpdater: axAIDeepSeekResponsesReqUpdater,
      supportFor,
    });

    super.setName('DeepSeek Responses');
  }
}
