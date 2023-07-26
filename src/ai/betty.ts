import {
  AIPromptConfig,
  AIService,
  EmbedResponse,
  GenerateTextModelConfig,
  GenerateTextResponse,
  TextModelInfo,
  TranscriptResponse,
} from '../text/types.js';

const modelInfo: TextModelInfo[] = [
  {
    id: 'betty-fake-completion-model',
    currency: 'usd',
    promptTokenCostPer1K: 0.03,
    completionTokenCostPer1K: 0.06,
    maxTokens: 1024,
    oneTPM: 1,
  },
  {
    id: 'betty-fake-embed-model',
    currency: 'usd',
    promptTokenCostPer1K: 0.003,
    completionTokenCostPer1K: 0.006,
    maxTokens: 8192,
    oneTPM: 1,
  },
];
/**
 * Betty: Fake AI Service for writing tests
 * @export
 */
export class Betty implements AIService {
  private answers: string[];
  private data: string[];
  private sdata: Map<string, string[]> = new Map();
  private index = 0;

  constructor(answers: readonly string[]) {
    this.answers = [...answers];
    this.data = [...answers];
  }

  getModelInfo(): Readonly<TextModelInfo> | undefined {
    return modelInfo.at(0);
  }

  getEmbedModelInfo(): Readonly<TextModelInfo> | undefined {
    return modelInfo.at(1);
  }

  getModelConfig(): Readonly<GenerateTextModelConfig> {
    return {
      maxTokens: 1024,
      temperature: 0.7,
      topP: 1,
      stream: false,
      logprobs: 0,
      echo: false,
      presencePenalty: 0,
      frequencyPenalty: 0,
      bestOf: 1,
      suffix: null,
    };
  }

  transcribe?(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _file: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _prompt?: string | undefined,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _language?: string | undefined,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _sessionID?: string | undefined
  ): Promise<TranscriptResponse> {
    throw new Error('Method not implemented.');
  }

  name(): string {
    return 'Betty';
  }

  generate(
    prompt: string,
    _md: Readonly<AIPromptConfig>,
    sessionID?: string
  ): Promise<GenerateTextResponse> {
    if (sessionID && !this.sdata.has(sessionID)) {
      this.sdata.set(sessionID, [...this.answers]);
    }
    const answers = sessionID ? this.sdata.get(sessionID) : this.data;

    const text = answers?.shift() || '';

    this.index++;

    const res = {
      remoteID: this.index.toString(),
      sessionID,
      modelUsage: {
        promptTokens: prompt.length,
        totalTokens: prompt.length + (text?.length || 0),
        completionTokens: text?.length || 0,
      },
      results: [{ id: '0', text }],
    };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    return new Promise((resolve, _reject) => {
      setTimeout(() => {
        resolve(res);
      }, 300);
    });
  }

  embed(
    textToEmbed: readonly string[] | string,
    sessionID?: string
  ): Promise<EmbedResponse> {
    const texts = typeof textToEmbed === 'string' ? [textToEmbed] : textToEmbed;
    const embedding = [1, 2, 3, 4];
    const res = {
      id: '',
      sessionID,
      texts,
      modelUsage: {
        promptTokens: texts.length,
        totalTokens: texts.length + embedding.length,
        completionTokens: embedding.length,
      },
      embedding,
    };
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(res);
      }, 300);
    });
  }
}
