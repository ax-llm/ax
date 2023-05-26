import {
  AIService,
  AIGenerateTextResponse,
  EmbedResponse,
  PromptConfig,
} from '../text';

/**
 * Betty: Fake AI Service for writing tests
 * @export
 */
export class Betty implements AIService {
  private answers: string[];
  private data: string[];
  private sdata: Map<string, string[]> = new Map();
  private index: number = 0;

  constructor(answers: string[]) {
    this.answers = [...answers];
    this.data = [...answers];
  }

  name(): string {
    return 'Betty';
  }

  generate(
    prompt: string,
    _md: PromptConfig,
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
      sessionID: sessionID,
      query: prompt,
      usage: {
        promptTokens: prompt.length,
        totalTokens: prompt.length + (text?.length || 0),
        completionTokens: text?.length || 0,
      },
      embedUsage: {
        promptTokens: 0,
        totalTokens: 0,
        completionTokens: 0,
      },
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

  embed(texts: string[], sessionID?: string): Promise<EmbedResponse> {
    const embeddings = [1, 2, 3, 4];
    const res = {
      id: '',
      sessionID: sessionID,
      texts: texts,
      model: '',
      usage: {
        promptTokens: texts.length,
        totalTokens: texts.length + embeddings.length,
        completionTokens: embeddings.length,
      },
      embeddings,
    };
    return new Promise((resolve, _) => {
      setTimeout(() => {
        resolve(res);
      }, 300);
    });
  }
}
