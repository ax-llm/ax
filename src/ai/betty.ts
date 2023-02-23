import { AIService, GenerateResponse, PromptMetadata } from '../text';

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
  ): Promise<GenerateResponse> {
    if (sessionID && !this.sdata.has(sessionID)) {
      this.sdata.set(sessionID, [...this.answers]);
    }
    const answers = sessionID ? this.sdata.get(sessionID) : this.data;
    const ans = answers.shift();
    this.index++;

    const res = {
      id: this.index.toString(),
      query: prompt,
      value: ans.trim(),
      values: [],
    };

    return new Promise((resolve, _) => {
      setTimeout(() => {
        resolve(res);
      }, 300);
    });
  }
}
