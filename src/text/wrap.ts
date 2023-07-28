import {
  AIGenerateTextTrace,
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
  private traces: AIGenerateTextTrace[] = [];
  private traceID: string;
  private ai: AIService;
  private rt?: RateLimiterFunction;

  constructor(ai: AIService, rateLimiter?: RateLimiterFunction) {
    this.ai = ai;
    this.rt = rateLimiter;
    this.traceID = uuid();
  }

  getTraces(): AIGenerateTextTrace[] {
    return this.traces;
  }

  getModelInfo(): Readonly<TextModelInfo> | undefined {
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

  getTrace(): AIGenerateTextTrace | undefined {
    return this.traces.at(-1);
  }

  private newTrace(prompt: string): AIGenerateTextTrace {
    const trace = {
      traceID: this.traceID,
      request: {
        prompt,
        modelInfo: this.ai.getModelInfo(),
        modelConfig: this.ai.getModelConfig(),
      },
    };
    this.traces.push(trace);
    return trace;
  }

  async generate(
    prompt: string,
    md: Readonly<AIPromptConfig>,
    sessionID?: string
  ): Promise<GenerateTextResponse> {
    let modelResponseTime;

    const fn = async () => {
      const st = new Date().getTime();
      const res = await this.ai.generate(prompt, md, sessionID);
      modelResponseTime = new Date().getTime() - st;
      return res;
    };

    const trace = this.newTrace(prompt);

    const res = this.rt
      ? await this.rt<Promise<GenerateTextResponse>>(fn)
      : await fn();

    if (trace) {
      trace.response = {
        remoteID: res.remoteID,
        results: res.results,
        modelUsage: res.modelUsage,
        embedModelUsage: res.embedModelUsage,
        modelResponseTime,
      };
    }

    return res;
  }

  async embed(
    textToEmbed: readonly string[] | string,
    sessionID?: string
  ): Promise<EmbedResponse> {
    let embedModelResponseTime;

    const fn = async () => {
      const st = new Date().getTime();
      const res = await this.ai.embed(textToEmbed, sessionID);
      embedModelResponseTime = new Date().getTime() - st;
      return res;
    };

    const trace = this.getTrace() as AIGenerateTextTrace;
    if (trace) {
      trace.request.embedModelInfo = this.ai.getEmbedModelInfo();
    }

    const res = this.rt
      ? await this.rt<Promise<EmbedResponse>>(async () => fn())
      : await fn();

    if (trace && trace.response) {
      trace.response.embedModelResponseTime = embedModelResponseTime;
      trace.response.embedModelUsage = res.modelUsage;
    }

    return res;
  }

  async transcribe(
    file: string,
    prompt?: string,
    language?: string,
    sessionID?: string
  ): Promise<TranscriptResponse> {
    if (!this.ai.transcribe) {
      throw new Error('Transcribe not supported');
    }
    return this.rt
      ? this.rt<Promise<TranscriptResponse>>(async () =>
          this.ai.transcribe
            ? await this.ai.transcribe(file, prompt, language, sessionID)
            : null
        )
      : await this.ai.transcribe(file, prompt, language, sessionID);
  }
}
