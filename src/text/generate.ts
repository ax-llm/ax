import { AIService, AIMemory, AIPrompt, GenerateResponse } from './index';
import { Memory } from './memory';
import { log } from './util';

/**
 * The main class for various text generation tasks
 * @export
 */

export class GenerateText {
  private ai: AIService;
  private mem: AIMemory;
  private maxSteps = 20;
  private debug = false;

  constructor(ai: AIService, mem: AIMemory = new Memory()) {
    this.ai = ai;
    this.mem = mem;
  }

  setMaxSteps(n: number) {
    this.maxSteps = n;
  }

  setDebug(b: boolean) {
    this.debug = b;
  }

  generate(
    query: string,
    prompt: AIPrompt,
    sessionID?: string
  ): Promise<GenerateResponse> {
    return new Promise((resolve) => {
      const res = this._generate(query, prompt, sessionID);
      resolve(res);
    });
  }

  private async _generate(
    query: string,
    prompt: AIPrompt,
    sessionID?: string
  ): Promise<GenerateResponse> {
    const q = query.trim();
    const md = prompt.metadata();
    const h = () => this.mem.history(sessionID);

    if (q === '') {
      throw new Error('not query found');
    }

    for (let i = 0; i < this.maxSteps; i++) {
      const p = prompt.create(query, h, this.ai);
      if (this.debug) {
        log(`> ${p}`, 'white');
      }

      const res = await this.ai.generate(p, md, sessionID);
      let done = false;

      if (this.debug) {
        log(`< ${res.value}`, 'red');
      }

      if (prompt.actions) {
        done = this.processAction(res, prompt, sessionID);
      } else {
        done = this.processSeq(q, res, prompt, sessionID);
      }

      if (res.value === '') {
        throw new Error('empty response from ai');
      }

      if (done) {
        return res;
      }
    }

    throw new Error(`query uses over max number of steps: ${this.maxSteps}`);
  }

  private processSeq(
    query: string,
    res: GenerateResponse,
    prompt: AIPrompt,
    sessionID?: string
  ): boolean {
    const md = prompt.metadata();
    const val = [md?.queryPrefix, query, md?.responsePrefix, res.value];
    this.mem.add(val.join(''), sessionID);
    return true;
  }

  private processAction(
    res: GenerateResponse,
    prompt: AIPrompt,
    sessionID?: string
  ): boolean {
    const md = prompt.metadata();
    const actions = prompt.actions();

    if (!md.actionName) {
      throw new Error('actionName parameter not set');
    }
    if (!md.actionValue) {
      throw new Error('actionValue parameter not set');
    }
    if (!md.finalValue) {
      throw new Error('finalValue parameter not set');
    }

    let actKey: string;
    let actVal: string;
    let v: string[] | null;

    const val = res.value;

    if ((v = md.finalValue.exec(val)) !== null) {
      const mval = [md?.responsePrefix, val];
      this.mem.add(mval.join(''), sessionID);
      res.value = v[1].trim();
      return true;
    }

    if ((v = md.actionName.exec(res.value)) !== null) {
      actKey = v[1].trim();
    }
    if ((v = md.actionValue.exec(res.value)) !== null) {
      actVal = v[1].trim();
    }

    const act = actions.find((v) => v.name === actKey);
    if (!act) {
      throw new Error(`invalid action found: ${actKey}`);
    }

    const actionResult = act.action(actVal);
    if (this.debug) {
      log(`> ${actKey}(${actVal}): ${actionResult}`, 'cyan');
    }

    const mval = [md?.responsePrefix, val, md?.queryPrefix, actionResult];
    this.mem.add(mval.join(''), sessionID);
    return false;
  }
}
