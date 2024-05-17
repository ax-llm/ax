import type {
  AIPromptConfig,
  AIService,
  AIServiceActionOptions,
  AIServiceOptions
} from '../text/types.js';
import {
  AITextTraceStepBuilder,
  TextRequestBuilder,
  TextResponseBuilder
} from '../tracing/index.js';
import type {
  AITextChatRequest,
  AITextEmbedRequest,
  AITextTraceStep,
  TextModelInfoWithProvider
} from '../tracing/types.js';
import { type API, apiCall } from '../util/apicall.js';
import { ColorLog } from '../util/log.js';
import { RespTransformStream } from '../util/transform.js';

import { MemoryCache } from './cache.js';
import type {
  EmbedResponse,
  RateLimiterFunction,
  TextModelConfig,
  TextModelInfo,
  TextResponse
} from './types.js';
import { hashObject, mergeTextResponses } from './util.js';
import type { ReadableStream } from 'stream/web';

const cache = new MemoryCache<TextResponse>();
const colorLog = new ColorLog();

interface BaseAIArgs {
  name: string;
  apiURL: string;
  headers: Record<string, string>;
  modelInfo: Readonly<TextModelInfo[]>;
  models: Readonly<{ model: string; embedModel?: string }>;
  options?: Readonly<AIServiceOptions>;
  supportFor: { functions: boolean };
}

export class BaseAI<
  TChatRequest,
  TEmbedRequest,
  TChatResponse,
  TChatResponseDelta,
  TEmbedResponse
> implements AIService
{
  generateChatReq?: (
    req: Readonly<AITextChatRequest>,
    config: Readonly<AIPromptConfig>
  ) => [API, TChatRequest];
  generateEmbedReq?: (
    req: Readonly<AITextEmbedRequest>
  ) => [API, TEmbedRequest];
  generateChatResp?: (resp: Readonly<TChatResponse>) => TextResponse;
  generateChatStreamResp?: (resp: Readonly<TChatResponseDelta>) => TextResponse;
  generateEmbedResp?: (resp: Readonly<TEmbedResponse>) => EmbedResponse;

  private debug = false;
  private disableLog = false;

  private rt?: RateLimiterFunction;
  private log?: (traceStep: Readonly<AITextTraceStep>) => void;

  private traceStepBuilder?: AITextTraceStepBuilder;
  private traceStepReqBuilder?: TextRequestBuilder;
  private traceStepRespBuilder?: TextResponseBuilder;

  protected apiURL: string;
  protected name: string;
  protected headers: Record<string, string>;
  protected modelInfo: TextModelInfo;
  protected embedModelInfo?: TextModelInfo;
  protected supportFor: BaseAIArgs['supportFor'];

  constructor({
    name,
    apiURL,
    headers,
    modelInfo,
    models,
    options = {},
    supportFor
  }: Readonly<BaseAIArgs>) {
    this.name = name;
    this.apiURL = apiURL;
    this.headers = headers;
    this.supportFor = supportFor;

    if (models.model.length === 0) {
      throw new Error('No model defined');
    }

    this.modelInfo = modelInfo.filter((v) => v.name === models.model).at(0) ?? {
      name: models.model,
      currency: 'usd',
      promptTokenCostPer1M: 0,
      completionTokenCostPer1M: 0
    };

    this.embedModelInfo = modelInfo
      .filter((v) => v.name === models.embedModel)
      .at(0);

    this.setOptions(options);
  }

  public setName(name: string): void {
    this.name = name;
  }

  public setAPIURL(apiURL: string): void {
    this.apiURL = apiURL;
  }

  public setHeaders(headers: Record<string, string>): void {
    this.headers = headers;
  }

  setOptions(options: Readonly<AIServiceOptions>): void {
    if (options.debug) {
      this.debug = options.debug;
    }

    if (options.disableLog) {
      this.disableLog = options.disableLog;
    }

    if (options.log) {
      this.log = options.log;
    }

    if (options.rateLimiter) {
      this.rt = options.rateLimiter;
    }
  }

  getModelInfo(): Readonly<TextModelInfoWithProvider> {
    return { ...this.modelInfo, provider: this.name };
  }

  getEmbedModelInfo(): TextModelInfoWithProvider | undefined {
    return this.embedModelInfo
      ? { ...this.embedModelInfo, provider: this.name }
      : undefined;
  }

  getName(): string {
    return this.name;
  }

  getFeatures(): BaseAIArgs['supportFor'] {
    return this.supportFor;
  }

  getModelConfig(): TextModelConfig {
    throw new Error('getModelConfig not implemented');
  }

  getTraceRequest(): Readonly<TextRequestBuilder> | undefined {
    return this.traceStepReqBuilder;
  }

  getTraceResponse(): Readonly<TextResponseBuilder> | undefined {
    return this.traceStepRespBuilder;
  }

  traceExists(): boolean {
    return (
      this.traceStepBuilder !== undefined &&
      this.traceStepReqBuilder !== undefined &&
      this.traceStepRespBuilder !== undefined
    );
  }

  async logTrace(): Promise<void> {
    if (
      !this.traceStepBuilder ||
      !this.traceStepReqBuilder ||
      !this.traceStepRespBuilder
    ) {
      throw new Error('Trace not initialized');
    }

    const traceStep = this.traceStepBuilder
      .setRequest(this.traceStepReqBuilder)
      .setResponse(this.traceStepRespBuilder)
      .build();

    if (this.log) {
      this.log?.(traceStep);
    }

    // if (this.debug) {
    //   this.consoleLog.log(traceStep);
    // }
  }

  async chat(
    _req: Readonly<AITextChatRequest>,
    options?: Readonly<AIPromptConfig & AIServiceActionOptions>
  ): Promise<TextResponse | ReadableStream<TextResponse>> {
    let hashKey: string | undefined;

    if (options?.cache) {
      hashKey = hashObject(_req);
      const cached = await cache.get(hashKey);
      if (cached) {
        return cached;
      }
    }

    if (!this.generateChatReq) {
      throw new Error('generateChatReq not implemented');
    }

    let startTime = 0;

    const reqFn = this.generateChatReq;
    const stream = options?.stream ?? _req.modelConfig?.stream;
    const functions =
      _req.functions && _req.functions.length > 0 ? _req.functions : undefined;
    const req = {
      ..._req,
      functions,
      modelConfig: { ..._req.modelConfig, stream }
    } as Readonly<AITextChatRequest>;

    const fn = async () => {
      startTime = new Date().getTime();
      const [apiConfig, reqValue] = reqFn(req, options as AIPromptConfig);

      const res = await apiCall(
        {
          name: apiConfig.name,
          url: this.apiURL,
          headers: this.buildHeaders(apiConfig.headers),
          stream,
          debug: this.debug
        },
        reqValue
      );
      return res;
    };

    this.setStep(options);
    this.traceStepReqBuilder = new TextRequestBuilder().setChatStep(
      req,
      this.getModelConfig(),
      this.getModelInfo()
    );

    if (this.debug) {
      logChatRequest(req);
    }

    const rv = this.rt ? await this.rt(fn) : await fn();

    if (stream) {
      if (!this.generateChatStreamResp) {
        throw new Error('generateChatResp not implemented');
      }

      const respFn = this.generateChatStreamResp;
      const wrappedRespFn = (resp: Readonly<TChatResponseDelta>) => {
        const res = respFn(resp);
        res.sessionId = options?.sessionId;
        return res;
      };

      const doneCb = async (values: readonly TextResponse[]) => {
        const res = mergeTextResponses(values);
        await this.setStepTextResponse(res, startTime);
        if (options?.cache && hashKey) {
          cache.set(hashKey, res, options?.cacheMaxAgeSeconds ?? 3600);
        }
      };

      const st = (rv as ReadableStream<TChatResponseDelta>).pipeThrough(
        new RespTransformStream<TChatResponseDelta, TextResponse>(
          wrappedRespFn,
          doneCb
        )
      );
      return st;
    }

    if (!this.generateChatResp) {
      throw new Error('generateChatResp not implemented');
    }
    const res = this.generateChatResp(rv as TChatResponse);
    await this.setStepTextResponse(res, new Date().getTime() - startTime);
    res.sessionId = options?.sessionId;

    if (options?.cache && hashKey) {
      cache.set(hashKey, res, options?.cacheMaxAgeSeconds ?? 3600);
    }
    return res;
  }

  async embed(
    req: Readonly<AITextEmbedRequest>,
    options?: Readonly<AIServiceActionOptions>
  ): Promise<EmbedResponse> {
    let modelResponseTime;

    if (!this.generateEmbedReq) {
      throw new Error('generateEmbedReq not implemented');
    }
    if (!this.generateEmbedResp) {
      throw new Error('generateEmbedResp not implemented');
    }

    const fn = async () => {
      const st = new Date().getTime();

      const [apiConfig, reqValue] = this.generateEmbedReq!(req);
      const res = await apiCall(
        {
          name: apiConfig.name,
          url: this.apiURL,
          headers: this.buildHeaders(apiConfig.headers),
          debug: this.debug
        },
        reqValue
      );
      modelResponseTime = new Date().getTime() - st;
      return res;
    };

    this.setStep(options);
    this.traceStepReqBuilder = new TextRequestBuilder().setEmbedStep(
      req,
      this.getEmbedModelInfo()
    );

    const resValue = this.rt ? await this.rt(async () => fn()) : await fn();

    const res = this.generateEmbedResp!(resValue as TEmbedResponse);

    this.traceStepRespBuilder = new TextResponseBuilder()
      .setModelUsage(res.modelUsage)
      .setModelResponseTime(modelResponseTime);

    res.sessionId = options?.sessionId;
    return res;
  }

  // async _transcribe(
  //   // eslint-disable-next-line @typescript-eslint/no-unused-vars
  //   _file: string,
  //   // eslint-disable-next-line @typescript-eslint/no-unused-vars
  //   _prompt?: string,
  //   // eslint-disable-next-line @typescript-eslint/no-unused-vars
  //   _options?: Readonly<AITranscribeConfig & AIServiceActionOptions>
  // ): Promise<TranscriptResponse> {
  //   throw new Error('_transcribe not implemented');
  // }

  // async transcribe(
  //   file: string,
  //   prompt?: string,
  //   options?: Readonly<AITranscribeConfig & AIServiceActionOptions>
  // ): Promise<TranscriptResponse> {
  //   const res = this.rt
  //     ? await this.rt<Promise<TranscriptResponse>>(
  //         async () => await this._transcribe(file, prompt, options)
  //       )
  //     : await this._transcribe(file, prompt, options);

  //   res.sessionId = options?.sessionId;
  //   return res;
  // }

  // async apiCallWithUpload<Request, Response, APIType extends API >(
  //   api: APIType,
  //   json: Request,
  //   file: string
  // ): Promise<Response> {
  // return apiCallWithUpload<Request, Response, APIType>(this.mergeAPIConfig<APIType>(api), json, file);
  // }

  setStep(options?: Readonly<AIServiceActionOptions>) {
    this.traceStepBuilder = new AITextTraceStepBuilder()
      .setTraceId(options?.traceId)
      .setSessionId(options?.sessionId);
  }

  async setStepTextResponse(res: Readonly<TextResponse>, startTime: number) {
    if (this.debug) {
      logResponse(res as TextResponse);
    }

    this.traceStepRespBuilder = new TextResponseBuilder()
      .setResults(res.results)
      .setModelUsage(res.modelUsage)
      .setModelResponseTime(new Date().getTime() - startTime);

    if (!this.disableLog) {
      await this.logTrace();
    }
  }

  private buildHeaders(
    headers: Record<string, string> = {}
  ): Record<string, string> {
    return { ...headers, ...this.headers };
  }
}

const logChatRequest = (req: Readonly<AITextChatRequest>) => {
  const items = req.chatPrompt?.map((v) => v.content).join('\n');
  if (items) {
    console.log(colorLog.whiteBright(items));
  }
};

const logResponse = (res: Readonly<TextResponse>) => {
  const items = res.results.map((v) => v.content).join('\n');
  if (items) {
    console.log(colorLog.greenBright(items));
  }

  const funcs = res.results
    .at(0)
    ?.functionCalls?.map((v) => v.function.name + ': ' + v.function.arguments)
    ?.join('\n');

  if (funcs) {
    console.log(colorLog.greenBright(funcs));
  }
};
