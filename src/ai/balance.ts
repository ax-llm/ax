import type { ReadableStream } from 'stream/web';

import type {
  AxAIPromptConfig,
  AxAIService,
  AxAIServiceActionOptions,
  AxAIServiceOptions,
  AxChatRequest,
  AxChatResponse,
  AxEmbedRequest,
  AxEmbedResponse,
  AxModelConfig,
  AxModelInfo
} from './types.js';

export class AxBalancer implements AxAIService {
  private services: AxAIService[];
  private currentServiceIndex: number = 0;
  private currentService: AxAIService;

  constructor(services: readonly AxAIService[]) {
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

  getModelInfo(): Readonly<AxModelInfo & { provider: string }> {
    return this.currentService.getModelInfo();
  }

  getEmbedModelInfo(): Readonly<AxModelInfo> | undefined {
    return this.currentService.getEmbedModelInfo();
  }

  getModelConfig(): Readonly<AxModelConfig> {
    return this.currentService.getModelConfig();
  }

  getFeatures() {
    return this.currentService.getFeatures();
  }

  async chat(
    req: Readonly<AxChatRequest>,
    options?: Readonly<AxAIPromptConfig & AxAIServiceActionOptions> | undefined
  ): Promise<AxChatResponse | ReadableStream<AxChatResponse>> {
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
    req: Readonly<AxEmbedRequest>,
    options?: Readonly<AxAIServiceActionOptions> | undefined
  ): Promise<AxEmbedResponse> {
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

  setOptions(options: Readonly<AxAIServiceOptions>): void {
    this.currentService.setOptions(options);
  }
}
