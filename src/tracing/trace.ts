import superagent from 'superagent';

import {
  AIGenerateTextTraceStep,
  AIGenerateTextTraceStepRequest,
  AIGenerateTextTraceStepResponse,
  APIError,
  FuncTrace,
  GenerateTextModelConfig,
  ParsingError,
  TextModelInfo,
  TextModelInfoWithProvider,
  TokenUsage,
} from '../text/types';
import { uuid } from '../text/util.js';

export class ModelInfoBuilder {
  private info: TextModelInfoWithProvider = {} as TextModelInfoWithProvider;

  setName(name: string): this {
    this.info.name = name;
    return this;
  }

  setCurrency(currency: string): this {
    this.info.currency = currency;
    return this;
  }

  setCharacterIsToken(characterIsToken: boolean): this {
    this.info.characterIsToken = characterIsToken;
    return this;
  }

  setPromptTokenCostPer1K(promptTokenCostPer1K: number): this {
    this.info.promptTokenCostPer1K = promptTokenCostPer1K;
    return this;
  }

  setCompletionTokenCostPer1K(completionTokenCostPer1K: number): this {
    this.info.completionTokenCostPer1K = completionTokenCostPer1K;
    return this;
  }

  setMaxTokens(maxTokens: number): this {
    this.info.maxTokens = maxTokens;
    return this;
  }

  setProvider(provider: string): this {
    this.info.provider = provider;
    return this;
  }

  build(): TextModelInfo & { provider: string } {
    return this.info;
  }
}

export class ModelConfigBuilder {
  private config: GenerateTextModelConfig = {} as GenerateTextModelConfig;

  setMaxTokens(maxTokens: number): this {
    this.config.maxTokens = maxTokens;
    return this;
  }

  setTemperature(temperature: number): this {
    this.config.temperature = temperature;
    return this;
  }

  setTopP(topP: number): this {
    this.config.topP = topP;
    return this;
  }

  setTopK(topK: number): this {
    this.config.topK = topK;
    return this;
  }

  setN(n: number): this {
    this.config.n = n;
    return this;
  }

  setStream(stream: boolean): this {
    this.config.stream = stream;
    return this;
  }

  setLogprobs(logprobs: number): this {
    this.config.logprobs = logprobs;
    return this;
  }

  setEcho(echo: boolean): this {
    this.config.echo = echo;
    return this;
  }

  setPresencePenalty(presencePenalty: number): this {
    this.config.presencePenalty = presencePenalty;
    return this;
  }

  setFrequencyPenalty(frequencyPenalty: number): this {
    this.config.frequencyPenalty = frequencyPenalty;
    return this;
  }

  setBestOf(bestOf: number): this {
    this.config.bestOf = bestOf;
    return this;
  }

  setLogitBias(logitBias: ReadonlyMap<string, number>): this {
    this.config.logitBias = logitBias as Map<string, number>;
    return this;
  }

  setSuffix(suffix: string | null): this {
    this.config.suffix = suffix;
    return this;
  }

  build(): GenerateTextModelConfig {
    return this.config;
  }
}

export class GenerateTextResponseBuilder {
  private response: AIGenerateTextTraceStepResponse =
    {} as AIGenerateTextTraceStepResponse;

  addResult(
    result: Readonly<{ text: string; id?: string; finishReason?: string }>
  ): this {
    if (!this.response.results) {
      this.response.results = [];
    }
    this.response.results.push(result);
    return this;
  }

  setResults(
    results?: Readonly<{ text: string; id?: string; finishReason?: string }[]>
  ): this {
    this.response.results = [...(results ?? [])];
    return this;
  }

  setModelUsage(modelUsage?: Readonly<TokenUsage>): this {
    this.response.modelUsage = modelUsage;
    return this;
  }

  setEmbedModelUsage(embedModelUsage?: Readonly<TokenUsage>): this {
    this.response.embedModelUsage = embedModelUsage;
    return this;
  }

  setRemoteId(remoteId?: string): this {
    this.response.remoteId = remoteId;
    return this;
  }

  addFunction(func: Readonly<FuncTrace>): this {
    if (!this.response.functions) {
      this.response.functions = [];
    }
    this.response.functions.push(func);
    return this;
  }

  setModelResponseTime(modelResponseTime?: number): this {
    this.response.modelResponseTime = modelResponseTime;
    return this;
  }

  setEmbedModelResponseTime(embedModelResponseTime?: number): this {
    this.response.embedModelResponseTime = embedModelResponseTime;
    return this;
  }

  setParsingError(parsingError: Readonly<ParsingError>): this {
    this.response.parsingError = parsingError;
    return this;
  }

  setApiError(apiError: Readonly<APIError>): this {
    this.response.apiError = apiError;
    return this;
  }

  // Include other setter methods for all fields...

  build(): AIGenerateTextTraceStepResponse {
    return this.response;
  }
}

/*
let response = new GenerateTextResponseBuilder()
    .addResult({text: 'Text', id: '1', finishReason: 'Stop'})
    .addFunction({name: 'function1', args: '1', result: 'result1'})
    .setModelResponseTime(123)
    .setEmbedModelResponseTime(456)
    .setParsingError({message: 'error', value: 'value'})
    .setApiError({
      message: 'api error', 
      status: 400, 
      header: {'header1': 'value1'}, 
      request: {'request1': 'value1'}, 
      body: {'body1': 'value1'}
    })
    .build();
*/

export class GenerateTextRequestBuilder {
  private request: AIGenerateTextTraceStepRequest =
    {} as AIGenerateTextTraceStepRequest;

  setSystemPrompt(systemPrompt: string): this {
    this.request.systemPrompt = systemPrompt;
    return this;
  }

  setGenerateStep(
    prompt: string,
    modelConfig?: Readonly<GenerateTextModelConfig>,
    modelInfo?: Readonly<TextModelInfoWithProvider>
  ) {
    this.request.prompt = prompt;
    this.request.modelConfig = modelConfig;
    this.request.modelInfo = modelInfo;
    return this;
  }

  setEmbedStep(
    texts: readonly string[],
    modelInfo?: Readonly<TextModelInfoWithProvider>
  ) {
    this.request.texts = texts;
    this.request.modelInfo = modelInfo;
    return this;
  }

  build(): Readonly<{
    prompt: string;
    modelConfig?: Readonly<GenerateTextModelConfig>;
    modelInfo?: Readonly<TextModelInfoWithProvider>;
    embedModelInfo?: Readonly<TextModelInfoWithProvider>;
  }> {
    return this.request;
  }
}

export class AIGenerateTextTraceStepBuilder {
  private traceStep: AIGenerateTextTraceStep = {} as AIGenerateTextTraceStep;

  setTraceId(traceId?: string): this {
    this.traceStep.traceId = traceId ? traceId : uuid();
    return this;
  }

  setSessionId(sessionId?: string): this {
    this.traceStep.sessionId = sessionId;
    return this;
  }

  setRequest(request: Readonly<GenerateTextRequestBuilder>): this {
    this.traceStep.request = request.build();
    return this;
  }

  setResponse(response: Readonly<GenerateTextResponseBuilder>): this {
    this.traceStep.response = response.build();
    return this;
  }

  setModelResponseTime(modelResponseTime?: number): this {
    this.traceStep.response.modelResponseTime = modelResponseTime;
    return this;
  }

  build(): AIGenerateTextTraceStep {
    this.traceStep.createdAt = new Date().toISOString();
    return this.traceStep;
  }
}

export const sendTrace = async (
  step: Readonly<AIGenerateTextTraceStep>,
  apiKey: string,
  devMode: boolean
) => {
  const { traceId, sessionId } = step;
  const baseUrl = devMode
    ? 'http://localhost:3000'
    : 'https://api.llmclient.com';

  await superagent
    .post(new URL(`/api/t/traces`, baseUrl).toString())
    .set('x-api-key', apiKey)
    .send({ traceId, sessionId, step })
    .type('json')
    .accept('json')
    .retry(3);
};
