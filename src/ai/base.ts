import { ConsoleLogger } from '../logs/console.js';
import { RemoteLogger } from '../logs/remote.js';
import {
  AIGenerateTextTraceStep,
  AIPromptConfig,
  AIService,
  AIServiceOptions,
  EmbedResponse,
  GenerateTextModelConfig,
  GenerateTextResponse,
  RateLimiterFunction,
  TextModelInfo,
  TranscriptResponse,
} from '../text/types.js';
import { uuid } from '../text/util.js';

export class BaseAI implements AIService {
  private consoleLog = new ConsoleLogger();
  private remoteLog = new RemoteLogger();
  private debug = false;
  private disableLog = false;

  private rt?: RateLimiterFunction;
  private log?: (traceStep: Readonly<AIGenerateTextTraceStep>) => void;
  private traceSteps: AIGenerateTextTraceStep[] = [];
  private traceId: string;

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
    this.traceId = uuid();

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
    _md?: Readonly<AIPromptConfig> | undefined,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _sessionId?: string | undefined
  ): Promise<GenerateTextResponse> {
    throw new Error('Method not implemented.');
  }

  _embed(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _text2Embed: string | readonly string[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _sessionId?: string | undefined
  ): Promise<EmbedResponse> {
    throw new Error('Method not implemented.');
  }

  _transcribe(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _file: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _prompt?: string | undefined,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _language?: string | undefined,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _sessionId?: string | undefined
  ): Promise<TranscriptResponse> {
    throw new Error('Method not implemented.');
  }

  getTraceSteps(): AIGenerateTextTraceStep[] {
    return this.traceSteps;
  }

  getModelInfo(): Readonly<TextModelInfo & { provider: string }> {
    return { ...this.modelInfo, provider: this.aiName };
  }

  getEmbedModelInfo(): TextModelInfo | undefined {
    return this.embedModelInfo ? { ...this.embedModelInfo } : undefined;
  }

  name(): string {
    return this.aiName;
  }

  getModelConfig(): GenerateTextModelConfig {
    throw new Error('getModelConfig not implemented');
  }

  logTrace(): void {
    if (this.remoteLog) {
      this.traceSteps.forEach((step) => this.remoteLog?.log?.(step));
    }

    if (this.log) {
      this.traceSteps.forEach((step) => this.log?.(step));
    }

    if (this.debug) {
      this.traceSteps.forEach((step) => this.consoleLog.log(step));
    }
  }

  getTraceStep(): AIGenerateTextTraceStep | undefined {
    return this.traceSteps.at(-1);
  }

  private newTraceStep(prompt: string): AIGenerateTextTraceStep {
    const step = {
      traceId: this.traceId,
      request: {
        prompt,
        modelInfo: this.getModelInfo(),
        modelConfig: this.getModelConfig(),
      },
      response: {
        results: [],
      },
      createdAt: new Date().toISOString(),
    };
    this.traceSteps.push(step);
    return step;
  }

  async generate(
    prompt: string,
    md: Readonly<AIPromptConfig>,
    sessionId?: string
  ): Promise<GenerateTextResponse> {
    let modelResponseTime;

    const fn = async () => {
      const st = new Date().getTime();
      const res = await this._generate(prompt, md, sessionId);
      modelResponseTime = new Date().getTime() - st;
      return res;
    };

    const trace = this.newTraceStep(prompt);

    const res = this.rt
      ? await this.rt<Promise<GenerateTextResponse>>(fn)
      : await fn();

    if (trace) {
      trace.response = {
        remoteId: res?.remoteId,
        results: res?.results ?? [],
        modelUsage: res?.modelUsage,
        embedModelUsage: res?.embedModelUsage,
        modelResponseTime,
      };
    }

    if (!this.disableLog) {
      this.logTrace();
    }

    return res;
  }

  async embed(
    textToEmbed: readonly string[] | string,
    sessionId?: string
  ): Promise<EmbedResponse> {
    let embedModelResponseTime;

    const fn = async () => {
      const st = new Date().getTime();
      const res = await this._embed(textToEmbed, sessionId);
      embedModelResponseTime = new Date().getTime() - st;
      return res;
    };

    const step = this.getTraceStep() as AIGenerateTextTraceStep;
    if (step) {
      step.request.embedModelInfo = this.getEmbedModelInfo();
    }

    const res = this.rt
      ? await this.rt<Promise<EmbedResponse>>(async () => fn())
      : await fn();

    if (step) {
      step.response.embedModelResponseTime = embedModelResponseTime;
      step.response.embedModelUsage = res.modelUsage;
    }

    if (!this.disableLog) {
      this.logTrace();
    }

    return res;
  }

  async transcribe(
    file: string,
    prompt?: string,
    language?: string,
    sessionId?: string
  ): Promise<TranscriptResponse> {
    if (!this.transcribe) {
      throw new Error('Transcribe not supported');
    }

    return this.rt
      ? this.rt<Promise<TranscriptResponse>>(async () =>
          this._transcribe
            ? await this._transcribe(file, prompt, language, sessionId)
            : null
        )
      : await this._transcribe(file, prompt, language, sessionId);
  }
}
