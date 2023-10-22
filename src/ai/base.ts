import chalk from 'chalk';

// import { ConsoleLogger } from '../logs/console.js';
import { RemoteLogger } from '../logs/remote.js';
import {
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
import {
  AITextChatRequest,
  AITextCompletionRequest,
  AITextEmbedRequest,
  AITextTraceStep,
  TextModelInfoWithProvider
} from '../tracing/types.js';
import { API, apiCall } from '../util/apicall.js';

import {
  EmbedResponse,
  RateLimiterFunction,
  TextModelConfig,
  TextModelInfo,
  TextResponse
} from './types.js';
import {
  convertToChatRequest,
  convertToCompletionRequest,
  parseAndAddFunction
} from './util.js';

// AIServiceBase<
// TCompletionRequest,
// TChatRequest,
// TEmbedRequest,
// TCompletionResponse,
// TChatResponse,
// TEmbedResponse
// >

export class BaseAI<
  TCompletionRequest,
  TChatRequest,
  TEmbedRequest,
  TCompletionResponse,
  TChatResponse,
  TEmbedResponse
> implements AIService
{
  generateCompletionReq?: (
    req: Readonly<AITextCompletionRequest>,
    config: Readonly<AIPromptConfig>
  ) => [API, TCompletionRequest];
  generateChatReq?: (
    req: Readonly<AITextChatRequest>,
    config: Readonly<AIPromptConfig>
  ) => [API, TChatRequest];
  generateEmbedReq?: (req: Readonly<AITextChatRequest>) => [API, TEmbedRequest];
  generateCompletionResp?: (
    resp: Readonly<TCompletionResponse>
  ) => TextResponse;
  generateChatResp?: (resp: Readonly<TChatResponse>) => TextResponse;
  generateEmbedResp?: (resp: Readonly<TEmbedResponse>) => EmbedResponse;

  // private consoleLog = new ConsoleLogger();
  private remoteLog = new RemoteLogger();
  private debug = false;
  private disableLog = false;

  private rt?: RateLimiterFunction;
  private log?: (traceStep: Readonly<AITextTraceStep>) => void;

  private traceStepBuilder?: AITextTraceStepBuilder;
  private traceStepReqBuilder?: TextRequestBuilder;
  private traceStepRespBuilder?: TextResponseBuilder;

  protected apiURL: string;
  protected aiName: string;
  protected headers: Record<string, string>;
  protected modelInfo: TextModelInfo;
  protected embedModelInfo?: TextModelInfo;

  constructor(
    aiName: string,
    apiURL: string,
    headers: Record<string, string>,
    modelInfo: Readonly<TextModelInfo[]>,
    models: Readonly<{ model: string; embedModel?: string }>,
    options: Readonly<AIServiceOptions> = {}
  ) {
    this.aiName = aiName;
    this.apiURL = apiURL;
    this.headers = headers;

    if (models.model.length === 0) {
      throw new Error('No model defined');
    }

    this.modelInfo = modelInfo.filter((v) => v.name === models.model).at(0) ?? {
      name: models.model,
      currency: 'usd',
      promptTokenCostPer1K: 0,
      completionTokenCostPer1K: 0
    };

    this.embedModelInfo = modelInfo
      .filter((v) => v.name === models.embedModel)
      .at(0);

    this.setOptions(options);

    if (this.debug) {
      this.remoteLog.printDebugInfo();
    }
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

    if (options.llmClientAPIKey) {
      this.remoteLog.setAPIKey(options.llmClientAPIKey);
    }

    if (this.debug) {
      this.remoteLog.printDebugInfo();
    }
  }

  getModelInfo(): Readonly<TextModelInfoWithProvider> {
    return { ...this.modelInfo, provider: this.aiName };
  }

  getEmbedModelInfo(): TextModelInfoWithProvider | undefined {
    return this.embedModelInfo
      ? { ...this.embedModelInfo, provider: this.aiName }
      : undefined;
  }

  name(): string {
    return this.aiName;
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

  logTrace(): void {
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

    if (this.remoteLog) {
      this.remoteLog?.log?.(traceStep);
    }

    if (this.log) {
      this.log?.(traceStep);
    }

    // if (this.debug) {
    //   this.consoleLog.log(traceStep);
    // }
  }

  async completion(
    req: Readonly<AITextCompletionRequest>,
    options: Readonly<AIPromptConfig & AIServiceActionOptions> = {
      stopSequences: []
    }
  ): Promise<TextResponse> {
    let modelResponseTime;

    if (!this.generateCompletionReq && this.generateChatResp) {
      return await this.chat(convertToChatRequest(req), options);
    }
    if (!this.generateCompletionReq) {
      throw new Error('generateCompletionReq not implemented');
    }
    if (!this.generateCompletionResp) {
      throw new Error('generateCompletionResp not implemented');
    }

    const fn = async () => {
      const st = new Date().getTime();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const [apiConfig, reqValue] = this.generateCompletionReq!(
        req,
        options as AIPromptConfig
      );

      const res = await apiCall<TCompletionRequest, TCompletionResponse>(
        {
          name: apiConfig.name,
          url: this.apiURL,
          headers: this.buildHeaders(apiConfig.headers)
        },
        reqValue
      );
      modelResponseTime = new Date().getTime() - st;
      return res;
    };

    this.traceStepBuilder = new AITextTraceStepBuilder()
      .setTraceId(options?.traceId)
      .setSessionId(options?.sessionId);

    this.traceStepReqBuilder = new TextRequestBuilder().setCompletionStep(
      req,
      this.getModelConfig(),
      this.getModelInfo()
    );

    if (this.debug) {
      logCompletionRequest(req);
    }

    const respValue = this.rt
      ? await this.rt<Promise<TCompletionResponse>>(fn)
      : await fn();

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const res = this.generateCompletionResp!(respValue);
    parseAndAddFunction(res);

    if (this.debug) {
      logResponse(res);
    }

    this.traceStepRespBuilder = new TextResponseBuilder()
      .setResults(res.results)
      .setModelUsage(res.modelUsage)
      .setModelResponseTime(modelResponseTime);

    if (!this.disableLog) {
      this.logTrace();
    }

    res.sessionId = options?.sessionId;
    return res;
  }

  async chat(
    req: Readonly<AITextChatRequest>,
    options: Readonly<AIPromptConfig & AIServiceActionOptions> = {
      stopSequences: []
    }
  ): Promise<TextResponse> {
    let modelResponseTime;

    if (!this.generateChatReq && this.generateCompletionResp) {
      return await this.completion(convertToCompletionRequest(req), options);
    }
    if (!this.generateChatReq) {
      throw new Error('generateChatReq not implemented');
    }
    if (!this.generateChatResp) {
      throw new Error('generateChatResp not implemented');
    }

    const fn = async () => {
      const st = new Date().getTime();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const [apiConfig, reqValue] = this.generateChatReq!(
        req,
        options as AIPromptConfig
      );

      const res = await apiCall<TChatRequest, TChatResponse>(
        {
          name: apiConfig.name,
          url: this.apiURL,
          headers: this.buildHeaders(apiConfig.headers)
        },
        reqValue
      );

      modelResponseTime = new Date().getTime() - st;
      return res;
    };

    this.traceStepBuilder = new AITextTraceStepBuilder()
      .setTraceId(options?.traceId)
      .setSessionId(options?.sessionId);

    this.traceStepReqBuilder = new TextRequestBuilder().setChatStep(
      req,
      this.getModelConfig(),
      this.getModelInfo()
    );

    if (this.debug) {
      logChatRequest(req);
    }

    const respValue = this.rt
      ? await this.rt<Promise<TChatResponse>>(fn)
      : await fn();

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const res = this.generateChatResp!(respValue);
    parseAndAddFunction(res);

    if (this.debug) {
      logResponse(res);
    }

    this.traceStepRespBuilder = new TextResponseBuilder()
      .setResults(res.results)
      .setModelUsage(res.modelUsage)
      .setModelResponseTime(modelResponseTime);

    if (!this.disableLog) {
      this.logTrace();
    }

    res.sessionId = options?.sessionId;
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
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const [apiConfig, reqValue] = this.generateEmbedReq!(req);
      const respValue = await apiCall<TEmbedRequest, TEmbedResponse>(
        {
          name: apiConfig.name,
          url: this.apiURL,
          headers: this.buildHeaders(apiConfig.headers)
        },
        reqValue
      );
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const res = this.generateEmbedResp!(respValue);
      modelResponseTime = new Date().getTime() - st;
      return res;
    };

    this.traceStepBuilder = new AITextTraceStepBuilder()
      .setTraceId(options?.traceId)
      .setSessionId(options?.sessionId);

    this.traceStepReqBuilder = new TextRequestBuilder().setEmbedStep(
      req,
      this.getEmbedModelInfo()
    );

    const res = this.rt
      ? await this.rt<Promise<EmbedResponse>>(async () => fn())
      : await fn();

    this.traceStepRespBuilder = new TextResponseBuilder()
      .setEmbedModelUsage(res.modelUsage)
      .setEmbedModelResponseTime(modelResponseTime);

    if (!this.disableLog) {
      this.logTrace();
    }

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

  // private mergeAPIConfig<APIType extends API = API>(_api: APIType) : APIType {
  //   if (!this.apiConfig) {
  //     return _api
  //   }
  //   const api = {..._api}

  //   if (this.apiConfig.key) {
  //     api.key = this.apiConfig.key;
  //   }
  //   if (this.apiConfig.url) {
  //     api.url = this.apiConfig.url;
  //   }
  //   if (this.apiConfig.name) {
  //     api.name = this.apiConfig.name;
  //   }
  //   if (this.apiConfig.headers) {
  //     api.headers = [...api.headers, this.apiConfig.headers]
  //   }
  //   if (this.apiConfig.url !== "") {
  //     api.url = this.apiConfig.url;
  //   }
  //   return api
  // }

  private buildHeaders(
    headers: Record<string, string> = {}
  ): Record<string, string> {
    return { ...headers, ...this.headers };
  }
}

const logCompletionRequest = (req: Readonly<AITextCompletionRequest>) => {
  console.log(chalk.whiteBright('Request:'));
  console.log(
    `${chalk.blueBright('system')}: ${req.systemPrompt}\n${chalk.blueBright(
      'prompt'
    )}: ${req.prompt}`
  );
};

const logChatRequest = (req: Readonly<AITextChatRequest>) => {
  console.log(chalk.whiteBright('Request: '));
  const items =
    req.chatPrompt?.map(
      (v) => `${chalk.blueBright('> ' + v.role)}: ${v.text}`
    ) ?? [];
  console.log(items.join('\n'));
};

const logResponse = (res: Readonly<TextResponse>) => {
  console.log(chalk.whiteBright('Response:'));
  const prefix = res.results.length > 1 ? '> ' : '';
  console.log(
    chalk.green(res.results.map((v) => `${prefix}${v.text}`).join('\n')),
    '\n---\n\n'
  );
};
