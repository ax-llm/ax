import {
  AIPromptConfig,
  AIService,
  GenerateTextModelConfig,
  GenerateTextResponse,
  TextModelInfo,
} from '../text/types.js';

export class BaseAI implements AIService {
  protected aiName: string;
  protected modelInfo?: TextModelInfo;
  protected embedModelInfo?: TextModelInfo;

  constructor(
    aiName: string,
    modelInfo: Readonly<TextModelInfo[]>,
    options: Readonly<{ model: string; embedModel?: string }>
  ) {
    this.modelInfo = modelInfo.filter((v) => v.id === options.model).at(0);
    this.embedModelInfo = modelInfo
      .filter((v) => v.id === options.embedModel)
      .at(0);

    this.aiName = aiName;
  }

  getModelInfo(): TextModelInfo | undefined {
    return this.modelInfo ? { ...this.modelInfo } : undefined;
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
    _sessionID?: string
  ): Promise<GenerateTextResponse> {
    throw new Error('generate not implemented');
  }
}
