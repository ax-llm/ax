import {
  AIService,
  AIGenerateResponse,
  EmbedResponse,
  PromptMetadata,
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
    _md?: PromptMetadata,
    sessionID?: string
  ): Promise<AIGenerateResponse> {
    if (sessionID && !this.sdata.has(sessionID)) {
      this.sdata.set(sessionID, [...this.answers]);
    }
    const answers = sessionID ? this.sdata.get(sessionID) : this.data;
    const text = answers.shift();
    this.index++;

    const res = {
      id: this.index.toString(),
      sessionID: sessionID,
      query: prompt,
      values: [{ id: '0', text }],
      value: () => res.values[0].text,
    };

    return new Promise((resolve, _) => {
      setTimeout(() => {
        resolve(res);
      }, 300);
    });
  }

  embed(texts: string[], sessionID?: string): Promise<EmbedResponse> {
    const res = {
      id: '',
      sessionID: sessionID,
      texts: texts,
      model: '',
      embeddings: [1, 2, 3, 4],
    };
    return new Promise((resolve, _) => {
      setTimeout(() => {
        resolve(res);
      }, 300);
    });
  }
}
