import {
  AIGenerateTextResponse,
  AIPromptConfig,
  AIService,
  EmbedResponse,
  GenerateTextModelConfig,
  GenerateTextResponse,
  TextModelInfo,
  TranscriptResponse,
} from '../text/types.js';

import { log, uuid } from './util.js';

/**
 * Type of the rate limiter function
 * @export
 */
export type RateLimiterFunction = <T>(func: unknown) => T;

export class AI implements AIService {
  private responses: AIGenerateTextResponse[] = [];
  private requestID: string;
  private ai: AIService;
  private debug = false;
  private rt?: RateLimiterFunction;

  constructor(
    ai: AIService,
    debug: boolean,
    rateLimiter?: RateLimiterFunction
  ) {
    this.ai = ai;
    this.debug = debug;
    this.rt = rateLimiter;
    this.requestID = uuid();
  }

  getResponses(): AIGenerateTextResponse[] {
    return this.responses;
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

  getLastResponse(): AIGenerateTextResponse | undefined {
    return this.responses.at(-1);
  }

  private addResponse(response: Readonly<AIGenerateTextResponse>) {
    this.responses.push(response);
  }

  async generate(
    prompt: string,
    md: Readonly<AIPromptConfig>,
    sessionID?: string
  ): Promise<GenerateTextResponse> {
    if (this.debug) {
      log(`> ${prompt}`, 'white');
    }

    let modelResponseTime;

    const fn = async () => {
      const st = new Date().getTime();
      const res = await this.ai.generate(prompt, md, sessionID);
      modelResponseTime = new Date().getTime() - st;
      return res;
    };

    const res = this.rt
      ? await this.rt<Promise<AIGenerateTextResponse>>(fn)
      : await fn();

    if (this.debug) {
      const value = res.results.at(0)?.text;
      log(`< ${value}`, 'red');
    }

    this.addResponse({
      ...res,
      prompt,
      functions: [],
      requestID: this.requestID,
      modelInfo: this.ai.getModelInfo(),
      modelConfig: this.ai.getModelConfig(),
      modelResponseTime,
    });

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

    const res = this.rt
      ? await this.rt<Promise<EmbedResponse>>(async () => fn())
      : await fn();

    const lastRes = this.getLastResponse();
    if (lastRes) {
      lastRes.embedModelInfo = this.ai.getEmbedModelInfo();
      lastRes.embedModelUsage = res.modelUsage;
      lastRes.embedModelResponseTime = embedModelResponseTime;
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
