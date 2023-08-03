import {
  AIPromptConfig,
  AIService,
  EmbedResponse,
  GenerateTextModelConfig,
  GenerateTextResponse,
  TextModelInfo,
  TranscriptResponse,
} from '../text/types.js';

export class BaseAI implements AIService {
  protected aiName: string;
  protected modelInfo: TextModelInfo;
  protected embedModelInfo?: TextModelInfo;

  constructor(
    aiName: string,
    modelInfo: Readonly<TextModelInfo[]>,
    options: Readonly<{ model: string; embedModel?: string }>
  ) {
    this.modelInfo = modelInfo
      .filter((v) => v.name === options.model)
      .at(0) ?? {
      name: options.model,
      currency: 'usd',
      promptTokenCostPer1K: 0,
      completionTokenCostPer1K: 0,
    };

    this.embedModelInfo = modelInfo
      .filter((v) => v.name === options.embedModel)
      .at(0);

    this.aiName = aiName;
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

  async generate(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _prompt: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _md: Readonly<AIPromptConfig>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _sessionId?: string
  ): Promise<GenerateTextResponse> {
    throw new Error('generate not supported');
  }

  embed(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _text2Embed: readonly string[] | string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _sessionId?: string
  ): Promise<EmbedResponse> {
    throw new Error('embed not supported');
  }

  transcribe(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _file: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _prompt?: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _language?: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _sessionId?: string
  ): Promise<TranscriptResponse> {
    throw new Error('transcribe not supported');
  }
}
