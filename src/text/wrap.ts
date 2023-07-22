import {
  AIGenerateTextResponse,
  AIPromptConfig,
  AIService,
  AITokenUsage,
  AudioResponse,
  EmbedResponse,
} from '../text/types.js';

import { addUsage } from './util.js';

/**
 * Type of the rate limiter function
 * @export
 */
export type RateLimiterFunction = <T>(func: unknown) => T;

export class AI implements AIService {
  private usage: AITokenUsage[] = [];
  private ai: AIService;
  private rt?: RateLimiterFunction;

  constructor(ai: AIService, rateLimiter?: RateLimiterFunction) {
    this.ai = ai;
    this.rt = rateLimiter;
  }

  name(): string {
    return this.ai.name();
  }

  private addUsage(usage: readonly AITokenUsage[]) {
    this.usage = addUsage(this.usage, usage);
  }

  getUsage(): readonly AITokenUsage[] {
    return this.usage;
  }

  async generate(
    prompt: string,
    md: Readonly<AIPromptConfig>,
    sessionID?: string
  ): Promise<AIGenerateTextResponse<string>> {
    const res = this.rt
      ? await this.rt<Promise<AIGenerateTextResponse<string>>>(
          async () => await this.ai.generate(prompt, md, sessionID)
        )
      : await this.ai.generate(prompt, md, sessionID);

    this.addUsage(res.usage);
    return res;
  }

  async embed(
    textToEmbed: readonly string[] | string,
    sessionID?: string
  ): Promise<EmbedResponse> {
    if (!this.ai.embed) {
      throw new Error('Embed not supported');
    }
    const res = this.rt
      ? await this.rt<Promise<EmbedResponse>>(async () =>
          this.ai.embed ? await this.ai.embed(textToEmbed, sessionID) : null
        )
      : await this.ai.embed(textToEmbed, sessionID);

    this.addUsage([res.usage]);
    return res;
  }

  async transcribe(
    file: string,
    prompt?: string,
    language?: string,
    sessionID?: string
  ): Promise<AudioResponse> {
    if (!this.ai.transcribe) {
      throw new Error('Transcribe not supported');
    }
    return this.rt
      ? this.rt<Promise<AudioResponse>>(async () =>
          this.ai.transcribe
            ? await this.ai.transcribe(file, prompt, language, sessionID)
            : null
        )
      : await this.ai.transcribe(file, prompt, language, sessionID);
  }
}
