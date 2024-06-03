import type { ReadableStream } from 'stream/web';

import type {
  AIPromptConfig,
  AIService,
  AIServiceActionOptions,
  AIServiceOptions
} from '../text/index.js';
import type { AITextChatRequest, AITextEmbedRequest } from '../types/index.js';

import type {
  EmbedResponse,
  TextModelConfig,
  TextModelInfo,
  TextResponse
} from './types.js';

export class AIBalancer implements AIService {
  private services: AIService[];
  private currentServiceIndex: number = 0;
  private currentService: AIService;

  constructor(services: readonly AIService[]) {
    if (services.length === 0) {
      throw new Error('No AI services provided.');
    }
    this.services = [...services].sort((a, b) => {
      const aInfo = a.getModelInfo();
      const bInfo = b.getModelInfo();
      const aTotalCost =
        (aInfo.promptTokenCostPer1M || Infinity) +
        (aInfo.completionTokenCostPer1M || Infinity);
      const bTotalCost =
        (bInfo.promptTokenCostPer1M || Infinity) +
        (bInfo.completionTokenCostPer1M || Infinity);
      return aTotalCost - bTotalCost;
    });

    const cs = this.services[this.currentServiceIndex];
    if (cs === undefined) {
      throw new Error('Error initializing the AI services.'); // More specific error message
    }
    this.currentService = cs;
  }

  private getNextService(): boolean {
    const cs = this.services[++this.currentServiceIndex];
    if (cs === undefined) {
      return false;
    }
    this.currentService = cs;
    return true;
  }

  private reset(): void {
    this.currentServiceIndex = 0;
    const cs = this.services[this.currentServiceIndex];
    if (cs === undefined) {
      throw new Error('No AI services provided.');
    }
    this.currentService = cs;
  }

  getName(): string {
    return this.currentService.getName();
  }

  getModelInfo(): Readonly<TextModelInfo & { provider: string }> {
    return this.currentService.getModelInfo();
  }

  getEmbedModelInfo(): Readonly<TextModelInfo> | undefined {
    return this.currentService.getEmbedModelInfo();
  }

  getModelConfig(): Readonly<TextModelConfig> {
    return this.currentService.getModelConfig();
  }

  getFeatures(): { functions: boolean } {
    return this.currentService.getFeatures();
  }

  async chat(
    req: Readonly<AITextChatRequest>,
    options?: Readonly<AIPromptConfig & AIServiceActionOptions> | undefined
  ): Promise<TextResponse | ReadableStream<TextResponse>> {
    this.reset();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        return await this.currentService.chat(req, options);
      } catch (e) {
        if (!this.getNextService()) {
          throw e;
        }
      }
    }
  }

  async embed(
    req: Readonly<AITextEmbedRequest>,
    options?: Readonly<AIServiceActionOptions> | undefined
  ): Promise<EmbedResponse> {
    this.reset();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        return await this.currentService.embed(req, options);
      } catch (e) {
        if (!this.getNextService()) {
          throw e;
        }
      }
    }
  }

  setOptions(options: Readonly<AIServiceOptions>): void {
    this.currentService.setOptions(options);
  }
}
