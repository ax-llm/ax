import { ConsoleLogger } from '../logs/console.js';

import { buildFunctionsPrompt, processFunction } from './functions.js';
import { Memory } from './memory.js';
import {
  AIGenerateTextTrace,
  AIMemory,
  AIService,
  AITextResponse,
  GenerateTextExtraOptions,
  GenerateTextResponse,
  PromptConfig,
} from './types.js';
import { stringToObject } from './util.js';
import { AI, RateLimiterFunction } from './wrap.js';

export type Options = {
  sessionID?: string;
  memory?: AIMemory;
  rateLimiter?: RateLimiterFunction;
};

/**
 * The main class for various text generation tasks
 * @export
 */
export class AIPrompt<T> {
  private consoleLogger = new ConsoleLogger();
  private conf: PromptConfig<T>;
  private maxSteps = 20;
  private debug = false;

  constructor(
    conf: Readonly<PromptConfig<T>> = {
      stopSequences: [],
    }
  ) {
    this.conf = conf;
    this.debug = conf.debug || false;
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

  async generate(
    ai: AIService,
    query: string,
    { sessionID, memory, rateLimiter }: Options = {}
  ): Promise<AITextResponse<T>> {
    const wai = new AI(ai, rateLimiter);
    const [, value] = await this._generate(
      wai,
      memory || new Memory(),
      query,
      sessionID
    );
    const traces = wai.getTraces();

    if (this.debug) {
      this.consoleLogger.log(traces);
    }

    if (this.conf.log) {
      this.conf.log(traces);
    }

    return {
      sessionID,
      prompt: query,
      traces,
      value: () => value,
    };
  }

  private async _generate(
    ai: Readonly<AI>,
    mem: AIMemory,
    query: string,
    sessionID?: string
  ): Promise<[GenerateTextResponse, T]> {
    const { conf } = this;
    const { responseConfig, functions } = conf;
    const { keyValue, schema } = responseConfig || {};

    const extraOptions = {
      sessionID,
    };

    let res: GenerateTextResponse;
    let value: string;

    if (functions && functions?.length > 0) {
      [res, value] = await this._generateWithFunctions(
        ai,
        mem,
        query,
        extraOptions
      );
    } else {
      [res, value] = await this._generateDefault(ai, mem, query, extraOptions);
    }

    const retryCount = 3;

    for (let i = 0; i < retryCount; i++) {
      let fvalue: string | Map<string, string[]> | T;

      try {
        if (keyValue) {
          fvalue = stringToMap(value);
        } else if (schema) {
          fvalue = stringToObject<T>(value, schema);
        } else {
          fvalue = value;
        }

        return [res, fvalue] as [GenerateTextResponse, T];
      } catch (e: unknown) {
        const error = e as Error;

        const trace = ai.getTrace() as AIGenerateTextTrace;
        if (trace && trace.response) {
          trace.response.parsingError = {
            error: error.message,
            data: value,
          };
        }

        if (i < retryCount - 1) {
          continue;
        }

        const { fixedValue } = await this.fixSyntax(
          ai,
          mem,
          error,
          value,
          extraOptions
        );
        value = fixedValue;
      }
    }

    throw new Error(`unable to fix result syntax`);
  }

  private async _generateWithFunctions(
    ai: Readonly<AI>,
    mem: AIMemory,
    query: string,
    { sessionID }: Readonly<GenerateTextExtraOptions>
  ): Promise<[GenerateTextResponse, string]> {
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

    for (let i = 0; i < this.maxSteps; i++) {
      const p = this.create(query, sprompt, h, ai);

      const res = await ai.generate(p, conf, sessionID);
      const value = res.results.at(0)?.text?.trim() ?? '';

      if (value.length === 0) {
        throw new Error('empty response from llm');
      }

      const funcExec = await processFunction(value, functions, ai, sessionID);

      const mval = ['\n', value, '\nObservation: ', funcExec.result];
      mem.add(mval.join(''), sessionID);

      const trace = ai.getTrace() as AIGenerateTextTrace;
      if (trace && trace.response) {
        trace.response.functions = [
          ...(trace.response.functions ?? []),
          funcExec,
        ];
        trace.response.embedModelUsage = res.embedModelUsage;
      }

      if (funcExec.name === 'finalResult') {
        return [res, funcExec.result ?? ''];
      }
    }

    throw new Error(`query uses over max number of steps: ${this.maxSteps}`);
  }

  private async _generateDefault(
    ai: Readonly<AI>,
    mem: AIMemory,
    query: string,
    { sessionID }: Readonly<GenerateTextExtraOptions>
  ): Promise<[GenerateTextResponse, string]> {
    const { conf } = this;
    const { schema } = conf.responseConfig || {};

    const h = () => mem.history(sessionID);
    const sprompt: string = schema ? JSON.stringify(schema, null, 2) : '';

    const p = this.create(query, sprompt, h, ai);
    const res = await ai.generate(p, conf, sessionID);
    const value = res.results.at(0)?.text?.trim() ?? '';

    if (value.length === 0) {
      throw new Error('empty response from ai');
    }

    const mval = [
      this.conf.queryPrefix,
      query,
      this.conf.responsePrefix,
      value,
    ];
    mem.add(mval.join(''), sessionID);
    return [res, value];
  }

  private async fixSyntax(
    ai: Readonly<AI>,
    mem: AIMemory,
    error: Readonly<Error>,
    value: string,
    { sessionID }: Readonly<GenerateTextExtraOptions>
  ): Promise<{ fixedValue: string }> {
    const { conf } = this;
    const p = `${mem.history()}\nSyntax Error: ${error.message}\n${value}`;

    const res = await ai.generate(p, conf, sessionID);
    const fixedValue = res.results.at(0)?.text?.trim() ?? '';

    if (fixedValue.length === 0) {
      throw new Error('empty response from ai');
    }

    return { fixedValue };
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
