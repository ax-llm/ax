import {
  AIGenerateTextResponse,
  AIPromptConfig,
  AIService,
  EmbedResponse,
  TextModelInfo,
} from '../text/types.js';

const models: TextModelInfo[] = [
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

  name(): string {
    return 'Betty';
  }

  generate(
    prompt: string,
    _md: Readonly<AIPromptConfig>,
    sessionID?: string
  ): Promise<AIGenerateTextResponse<string>> {
    if (sessionID && !this.sdata.has(sessionID)) {
      this.sdata.set(sessionID, [...this.answers]);
    }
    const answers = sessionID ? this.sdata.get(sessionID) : this.data;

    const text = answers?.shift() || '';

    this.index++;

    const res = {
      id: this.index.toString(),
      sessionID,
      query: prompt,
      usage: [
        {
          model: models[0],
          stats: {
            promptTokens: prompt.length,
            totalTokens: prompt.length + (text?.length || 0),
            completionTokens: text?.length || 0,
          },
        },
      ],
      values: [{ id: '0', text }],
      value() {
        return this.values[0].text;
      },
    };

    return new Promise((resolve, _) => {
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
      usage: {
        model: models[1],
        stats: {
          promptTokens: texts.length,
          totalTokens: texts.length + embedding.length,
          completionTokens: embedding.length,
        },
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
