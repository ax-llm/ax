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
        log(`< ${res.values[0].text.trim()}`, 'red');
      }

      if (prompt.actions) {
        done = await this.processAction(res, prompt, sessionID);
      } else {
        done = await this.processSeq(q, res, prompt, sessionID);
      }

      if (res.values.length === 0) {
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
    const val = res.values[0].text.trim();
    const mval = [md?.queryPrefix, query, md?.responsePrefix, val];
    this.mem.add(mval.join(''), sessionID);
    return true;
  }

  private async processAction(
    res: GenerateResponse,
    prompt: AIPrompt,
    sessionID?: string
  ): Promise<boolean> {
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

    const val = res.values[0].text.trim();

    if ((v = md.finalValue.exec(val)) !== null) {
      const mval = [md?.responsePrefix, val];
      this.mem.add(mval.join(''), sessionID);
      res.values[0].text = v[1].trim();
      return true;
    }

    if ((v = md.actionName.exec(val)) !== null) {
      actKey = v[1].trim();
    }
    if ((v = md.actionValue.exec(val)) !== null) {
      actVal = v[1].trim();
    }

    const act = actions.find((v) => v.name === actKey);
    if (!act) {
      throw new Error(`invalid action found: ${actKey}`);
    }

    const actRes =
      act.action.length === 2
        ? act.action(actVal, await this.ai.embed([actVal], sessionID))
        : act.action(actVal);

    if (this.debug) {
      log(`> ${actKey}(${actVal}): ${actRes}`, 'cyan');
    }

    const mval = [md?.responsePrefix, val, md?.queryPrefix, actRes];
    this.mem.add(mval.join(''), sessionID);
    return false;
  }
}
