import { buildFunctionsPrompt, processFunction } from './functions.js';
import { Memory } from './memory.js';
import {
  AIGenerateTextExtraOptions,
  AIGenerateTextResponse,
  AIMemory,
  AIService,
  AITokenUsage,
  PromptConfig,
} from './types.js';
import { addUsage, log, stringToObject } from './util.js';

export type Options = {
  sessionID?: string;
  memory?: AIMemory;
};

/**
 * The main class for various text generation tasks
 * @export
 */
export class AIPrompt<T> {
  private conf: PromptConfig<T>;
  private maxSteps = 20;
  private debug = false;

  constructor(
    conf: Readonly<PromptConfig<T>> = {
      stopSequences: [],
    }
  ) {
    this.conf = conf;
  }

  setMaxSteps(maxSteps: number) {
    this.maxSteps = maxSteps;
  }

  setDebug(debug: boolean) {
    this.debug = debug;
  }

  create(
    query: string,
    system: string,
    history: () => string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _ai: AIService
  ): string {
    return `
    ${system}
    ${history()}
    ${query}
    `;
  }

  generate(
    ai: AIService,
    query: string,
    { sessionID, memory }: Options = {}
  ): Promise<AIGenerateTextResponse<T>> {
    return new Promise((resolve) => {
      const res = this._generate(ai, memory || new Memory(), query, sessionID);
      resolve(res);
    });
  }

  private async _generate(
    ai: AIService,
    mem: AIMemory,
    query: string,
    sessionID?: string
  ): Promise<AIGenerateTextResponse<T>> {
    const { conf } = this;
    const { responseConfig, functions } = conf;
    const { keyValue, schema } = responseConfig || {};

    const extraOptions = {
      sessionID,
      debug: this.debug,
    };

    let res: AIGenerateTextResponse<string>;

    if (functions && functions?.length > 0) {
      res = await this._generateWithFunctions(ai, mem, query, extraOptions);
    } else {
      res = await this._generateDefault(ai, mem, query, extraOptions);
    }

    let fvalue: string | Map<string, string[]> | T;

    let value = res.value();
    let totalUsage = res.usage;
    let error: Error | undefined;

    for (let i = 0; i < 3; i++) {
      try {
        if (keyValue) {
          fvalue = stringToMap(value);
        } else if (schema) {
          fvalue = stringToObject<T>(value, schema);
        } else {
          fvalue = value;
        }

        return {
          ...res,
          usage: totalUsage,
          value: () => fvalue as T,
        };
      } catch (e: unknown) {
        error = e as Error;
        const { fixedValue, usage } = await this.fixSyntax(
          ai,
          mem,
          error,
          value,
          extraOptions
        );
        value = fixedValue;
        totalUsage = addUsage(totalUsage, usage);
      }
    }
    throw new Error(`invalid response syntax: ${error?.message}`);
  }

  private async _generateWithFunctions(
    ai: AIService,
    mem: AIMemory,
    query: string,
    { sessionID, debug }: Readonly<AIGenerateTextExtraOptions>
  ): Promise<AIGenerateTextResponse<string>> {
    const { conf } = this;

    conf.stopSequences = [...conf.stopSequences, 'Observation:'];
    const h = () => mem.history(sessionID);

    const functions = conf.responseConfig?.schema
      ? [
          ...(conf.functions ?? []),
          {
            name: 'finalResult',
            description: 'function for the final result',
            inputSchema: conf.responseConfig.schema ?? {},
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            func: (args: any) => args,
          },
        ]
      : conf.functions ?? [];

    const sprompt: string = buildFunctionsPrompt(functions);
    let usage: AITokenUsage[] = [];

    for (let i = 0; i < this.maxSteps; i++) {
      const p = this.create(query, sprompt, h, ai);

      if (debug) {
        log(`> ${p}`, 'white');
      }

      const res = await ai.generate(p, conf, sessionID);
      const rval = res.value().trim();

      if (debug) {
        log(`< ${rval}`, 'red');
      }

      if (rval.length === 0) {
        throw new Error('empty response from ai');
      }
      usage = addUsage(usage, res.usage);

      const { done, usage: actionUsage } = await processFunction(
        functions,
        mem,
        res,
        {
          sessionID,
          debug,
        }
      );

      usage = addUsage(usage, actionUsage);
      if (done) {
        return { ...res, usage };
      }
    }

    throw new Error(`query uses over max number of steps: ${this.maxSteps}`);
  }

  private async _generateDefault(
    ai: AIService,
    mem: AIMemory,
    query: string,
    { sessionID, debug }: Readonly<AIGenerateTextExtraOptions>
  ): Promise<AIGenerateTextResponse<string>> {
    const { conf } = this;
    const { schema } = conf.responseConfig || {};

    const h = () => mem.history(sessionID);
    const sprompt: string = schema ? JSON.stringify(schema, null, '\t') : '';

    const p = this.create(query, sprompt, h, ai);

    if (debug) {
      log(`> ${p}`, 'white');
    }

    const res = await ai.generate(p, conf, sessionID);
    const rval = res.value().trim();

    if (debug) {
      log(`< ${rval}`, 'red');
    }

    const mval = [this.conf.queryPrefix, query, this.conf.responsePrefix, rval];
    mem.add(mval.join(''), sessionID);
    return res;
  }

  private async fixSyntax(
    ai: AIService,
    mem: AIMemory,
    error: Readonly<Error>,
    value: string,
    { sessionID, debug }: Readonly<AIGenerateTextExtraOptions>
  ): Promise<{ fixedValue: string; usage: AITokenUsage[] }> {
    const { conf } = this;
    const p = `${mem.history()}\nSyntax Error: ${error.message}\n${value}`;
    const res = await ai.generate(p, conf, sessionID);
    const fixedValue = res.value().trim();

    if (debug) {
      log(`Syntax Error: ${error.message}`, 'red');
      log(`< ${fixedValue}`, 'red');
    }

    return { fixedValue, usage: res.usage };
  }
}

const stringToMap = (text: string): Map<string, string[]> => {
  const vm = new Map<string, string[]>();
  const re = /([a-zA-Z ]+):\s{0,}\n?(((?!N\/A).)+)$/gm;

  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // This is necessary to avoid infinite loops with zero-width matches
    if (m.index === re.lastIndex) {
      re.lastIndex++;
    }
    vm.set(m[1], m[2].split(','));
  }
  if (vm.size === 0) {
    throw new Error('Expected format is a list of key: value');
  }
  return vm;
};
