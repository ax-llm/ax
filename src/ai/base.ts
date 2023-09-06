import { ConsoleLogger } from '../logs/console.js';
import { RemoteLogger } from '../logs/remote.js';
import {
  AIPromptConfig,
  AIService,
  AIServiceActionOptions,
  AIServiceOptions,
  AITranscribeConfig,
} from '../text/types.js';
import {
  AITextTraceStepBuilder,
  TextRequestBuilder,
  TextResponseBuilder,
} from '../tracing/index.js';
import {
  AITextTraceStep,
  TextModelInfoWithProvider,
} from '../tracing/types.js';

import {
  EmbedResponse,
  TextModelConfig,
  TextResponse,
  RateLimiterFunction,
  TextModelInfo,
  TranscriptResponse,
} from './types.js';

export class BaseAI implements AIService {
  private consoleLog = new ConsoleLogger();
  private remoteLog = new RemoteLogger();
  private debug = false;
  private disableLog = false;

  private rt?: RateLimiterFunction;
  private log?: (traceStep: Readonly<AITextTraceStep>) => void;

  private traceStepBuilder?: AITextTraceStepBuilder;
  private traceStepReqBuilder?: TextRequestBuilder;
  private traceStepRespBuilder?: TextResponseBuilder;

  protected aiName: string;
  protected modelInfo: TextModelInfo;
  protected embedModelInfo?: TextModelInfo;

  constructor(
    aiName: string,
    modelInfo: Readonly<TextModelInfo[]>,
    models: Readonly<{ model: string; embedModel?: string }>,
    options: Readonly<AIServiceOptions> = {}
  ) {
    this.aiName = aiName;

    if (models.model.length === 0) {
      throw new Error('No model defined');
    }

    this.modelInfo = modelInfo.filter((v) => v.name === models.model).at(0) ?? {
      name: models.model,
      currency: 'usd',
      promptTokenCostPer1K: 0,
      completionTokenCostPer1K: 0,
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

  _generate(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _prompt: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options?: Readonly<AIPromptConfig>
  ): Promise<TextResponse> {
    throw new Error('Method not implemented.');
  }

  _embed(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _text2Embed: string | readonly string[]
  ): Promise<EmbedResponse> {
    throw new Error('Method not implemented.');
  }

  _transcribe(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _file: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _prompt?: string | undefined,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options?: Readonly<AITranscribeConfig>
  ): Promise<TranscriptResponse> {
    throw new Error('Method not implemented.');
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

    if (this.debug) {
      this.consoleLog.log(traceStep);
    }
  }

  async generate(
    prompt: string,
    options?: Readonly<AIPromptConfig & AIServiceActionOptions>
  ): Promise<TextResponse> {
    let modelResponseTime;

    const fn = async () => {
      const st = new Date().getTime();
      const res = await this._generate(prompt, options);
      modelResponseTime = new Date().getTime() - st;
      return res;
    };

    this.traceStepBuilder = new AITextTraceStepBuilder()
      .setTraceId(options?.traceId)
      .setSessionId(options?.sessionId);

    this.traceStepReqBuilder = new TextRequestBuilder().setStep(
      prompt,
      this.getModelConfig(),
      this.getModelInfo()
    );

    const res = this.rt ? await this.rt<Promise<TextResponse>>(fn) : await fn();

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
    textToEmbed: readonly string[] | string,
    options?: Readonly<AIServiceActionOptions>
  ): Promise<EmbedResponse> {
    let modelResponseTime;

    const fn = async () => {
      const st = new Date().getTime();
      const res = await this._embed(textToEmbed);
      modelResponseTime = new Date().getTime() - st;
      return res;
    };

    this.traceStepBuilder = new AITextTraceStepBuilder()
      .setTraceId(options?.traceId)
      .setSessionId(options?.sessionId);

    this.traceStepReqBuilder = new TextRequestBuilder().setEmbedStep(
      typeof textToEmbed === 'string' ? [textToEmbed] : textToEmbed,
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

  async transcribe(
    file: string,
    prompt?: string,
    options?: Readonly<AITranscribeConfig & AIServiceActionOptions>
  ): Promise<TranscriptResponse> {
    if (!this._transcribe) {
      throw new Error('Transcribe not supported');
    }

    const res = this.rt
      ? await this.rt<Promise<TranscriptResponse>>(
          async () => await this._transcribe(file, prompt, options)
        )
      : await this._transcribe(file, prompt, options);

    res.sessionId = options?.sessionId;
    return res;
  }
}
