import { ConsoleLogger } from '../logs/console.js';
import { RemoteLogger } from '../logs/remote.js';
import {
  AIGenerateTextTraceStep,
  AIPromptConfig,
  AIService,
  EmbedResponse,
  GenerateTextModelConfig,
  GenerateTextResponse,
  TextModelInfo,
  TranscriptResponse,
} from '../text/types.js';

import { uuid } from './util.js';

/**
 * Type of the rate limiter function
 * @export
 */
export type RateLimiterFunction = <T>(func: unknown) => T;

export class AI implements AIService {
  private consoleLog = new ConsoleLogger();
  private remoteLog;

  private log?: (traceStep: Readonly<AIGenerateTextTraceStep>) => void;
  private traceSteps: AIGenerateTextTraceStep[] = [];
  private traceId: string;
  private ai: AIService;
  private rt?: RateLimiterFunction;

  constructor(
    ai: AIService,
    log?: (traceStep: Readonly<AIGenerateTextTraceStep>) => void,
    rateLimiter?: RateLimiterFunction,
    apiKey?: string
  ) {
    this.ai = ai;
    this.rt = rateLimiter;
    this.traceId = uuid();
    this.log = log;

    if (apiKey) {
      const devMode = process.env.DEV_MODE === 'true';
      this.remoteLog = new RemoteLogger(apiKey, devMode);
    }
  }

  getTraceSteps(): AIGenerateTextTraceStep[] {
    return this.traceSteps;
  }

  getModelInfo(): Readonly<TextModelInfo & { provider: string }> {
    throw new Error('Method not implemented.');
  }
  getEmbedModelInfo(): Readonly<TextModelInfo> | undefined {
    throw new Error('Method not implemented.');
  }
  getModelConfig(): Readonly<GenerateTextModelConfig> {
    throw new Error('Method not implemented.');
  }

  name(): string {
    return this.ai.name();
  }

  logTrace(): void {
    if (this.traceSteps.length === 0) {
      return;
    }

    if (this.remoteLog) {
      this.traceSteps.forEach((step) => this.remoteLog?.log?.(step));
    }

    if (this.log) {
      this.traceSteps.forEach((step) => this.log?.(step));
    }
  }

  consoleLogTrace(): void {
    this.traceSteps.forEach((step) => this.consoleLog.log(step));
  }

  getTraceStep(): AIGenerateTextTraceStep | undefined {
    return this.traceSteps.at(-1);
  }

  private newTraceStep(prompt: string): AIGenerateTextTraceStep {
    const step = {
      traceId: this.traceId,
      request: {
        prompt,
        modelInfo: this.ai.getModelInfo(),
        modelConfig: this.ai.getModelConfig(),
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
      const res = await this.ai.generate(prompt, md, sessionId);
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

    return res;
  }

  async embed(
    textToEmbed: readonly string[] | string,
    sessionId?: string
  ): Promise<EmbedResponse> {
    let embedModelResponseTime;

    const fn = async () => {
      const st = new Date().getTime();
      const res = await this.ai.embed(textToEmbed, sessionId);
      embedModelResponseTime = new Date().getTime() - st;
      return res;
    };

    const step = this.getTraceStep() as AIGenerateTextTraceStep;
    if (step) {
      step.request.embedModelInfo = this.ai.getEmbedModelInfo();
    }

    const res = this.rt
      ? await this.rt<Promise<EmbedResponse>>(async () => fn())
      : await fn();

    if (step) {
      step.response.embedModelResponseTime = embedModelResponseTime;
      step.response.embedModelUsage = res.modelUsage;
    }

    return res;
  }

  async transcribe(
    file: string,
    prompt?: string,
    language?: string,
    sessionId?: string
  ): Promise<TranscriptResponse> {
    if (!this.ai.transcribe) {
      throw new Error('Transcribe not supported');
    }
    return this.rt
      ? this.rt<Promise<TranscriptResponse>>(async () =>
          this.ai.transcribe
            ? await this.ai.transcribe(file, prompt, language, sessionId)
            : null
        )
      : await this.ai.transcribe(file, prompt, language, sessionId);
  }
}
