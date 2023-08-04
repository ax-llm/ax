import { JSONSchemaType } from 'ajv';

import {
  finalResultFunc,
  functionsToJSON,
  parseFunction,
  processFunction,
} from './functions.js';
import { Memory } from './memory.js';
import {
  AIGenerateTextTrace,
  AIMemory,
  AIService,
  AITextResponse,
  FunctionExec,
  GenerateTextExtraOptions,
  GenerateTextResponse,
  PromptConfig,
  PromptFunction,
} from './types.js';
import { stringToObject } from './util.js';
import { AI, RateLimiterFunction } from './wrap.js';

export type Options = {
  sessionId?: string;
  memory?: AIMemory;
  rateLimiter?: RateLimiterFunction;
};

/**
 * The main class for various text generation tasks
 * @export
 */
export class AIPrompt<T> {
  private conf: PromptConfig<T>;
  private functions: PromptFunction[];
  private maxSteps = 10;
  private debug = false;

  constructor(
    conf: Readonly<PromptConfig<T>> = {
      stopSequences: [],
    }
  ) {
    this.conf = { ...conf };
    this.functions = this.conf.functions ?? [];
    this.debug = conf.debug || false;

    if (this.functions.length > 0 && this.conf.responseConfig?.schema) {
      this.functions = [
        ...this.functions,
        finalResultFunc(this.conf.responseConfig?.schema),
      ];
    }
  }

  setMaxSteps(maxSteps: number) {
    this.maxSteps = maxSteps;
  }

  setDebug(debug: boolean) {
    this.debug = debug;
  }

  functionsSchema(): string {
    return functionsToJSON(this.functions ?? []);
  }

  prompt(query: string, history: () => string): string {
    return `${query}\n${history()}\n`;
  }

  async generate(
    ai: AIService,
    query: string,
    { sessionId, memory, rateLimiter }: Options = {}
  ): Promise<AITextResponse<T>> {
    const wai = new AI(ai, this.conf.log, rateLimiter);
    const [, value] = await this._generate(
      wai,
      memory || new Memory(),
      query,
      sessionId
    );
    const traces = wai.getTraces();

    return {
      sessionId,
      prompt: query,
      traces,
      value: () => value,
    };
  }

  private async _generate(
    ai: Readonly<AI>,
    mem: AIMemory,
    query: string,
    sessionId?: string
  ): Promise<[GenerateTextResponse, T]> {
    try {
      return await this._generateHandler(ai, mem, query, sessionId);
    } catch (e: unknown) {
      const trace = ai.getTrace() as AIGenerateTextTrace;
      const err = e as Error;

      if (trace && trace.response) {
        trace.finalError = err.message;
      }
      throw new Error(err.message);
    } finally {
      if (this.debug) {
        ai.consoleLogTrace();
      }
      ai.logTrace();
    }
  }

  private async _generateHandler(
    ai: Readonly<AI>,
    mem: AIMemory,
    query: string,
    sessionId?: string
  ): Promise<[GenerateTextResponse, T]> {
    const { responseConfig } = this.conf;
    const { keyValue, schema } = responseConfig || {};

    const extraOptions = {
      sessionId,
    };

    let res: GenerateTextResponse;
    let value: string;

    if (this.functions && this.functions?.length > 0) {
      [res, value] = await this._generateWithFunctions(
        ai,
        mem,
        query,
        extraOptions
      );
    } else {
      [res, value] = await this._generateDefault(ai, mem, query, extraOptions);
    }

    const retryCount = 5;

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

        if (i === retryCount - 1) {
          continue;
        }

        const { fixedValue } = await this.fixResultSyntax<T>(
          ai,
          mem,
          error,
          value,
          extraOptions,
          this.conf.responseConfig?.schema
        );
        value = fixedValue;
      }
    }

    throw { message: `Unable to fix result syntax` };
  }

  private async _generateWithFunctions(
    ai: Readonly<AI>,
    mem: AIMemory,
    query: string,
    { sessionId }: Readonly<GenerateTextExtraOptions>
  ): Promise<[GenerateTextResponse, string]> {
    const h = () => mem.history(sessionId);

    let previousValue;

    for (let i = 0; i < this.maxSteps; i++) {
      const p = this.prompt(query, h);
      const res = await ai.generate(p, this.conf, sessionId);
      const value = res.results.at(0)?.text?.trim() ?? '';

      // check for duplicate responses
      if (previousValue && jaccardSimilarity(previousValue, value) > 0.8) {
        return [res, value];
      }

      // remember current response
      previousValue = value;

      // check for empty responses
      if (value.length === 0) {
        throw { message: `Empty response received` };
      }

      // check for functions
      const foundFunc = parseFunction(value);

      // loop back if no function found
      if (!foundFunc) {
        continue;
      }

      const funcExec = await processFunction(
        foundFunc.funcName,
        foundFunc.funcArgs,
        this.functions,
        ai,
        sessionId
      );

      const mval = [
        value,
        this.conf.stopSequences?.at(0) ?? '',
        funcExec.result,
      ];
      mem.add(`\n${mval.join('\n')}`, sessionId);

      const trace = ai.getTrace() as AIGenerateTextTrace;
      if (trace && trace.response) {
        addFuncToTrace(trace, funcExec);
        trace.response.embedModelUsage = res.embedModelUsage;
      }

      if (funcExec.name.localeCompare('finalResult') === 0) {
        return [res, funcExec.result ?? ''];
      }
    }

    throw { message: `max ${this.maxSteps} steps allowed` };
  }

  private async _generateDefault(
    ai: Readonly<AI>,
    mem: AIMemory,
    query: string,
    { sessionId }: Readonly<GenerateTextExtraOptions>
  ): Promise<[GenerateTextResponse, string]> {
    const h = () => mem.history(sessionId);
    const p = this.prompt(query, h);
    const res = await ai.generate(p, this.conf, sessionId);
    const value = res.results.at(0)?.text?.trim() ?? '';

    if (value.length === 0) {
      throw { message: 'Empty response received' };
    }

    const mval = [
      this.conf.queryPrefix,
      query,
      this.conf.responsePrefix,
      value,
    ];
    mem.add(mval.join(''), sessionId);
    return [res, value];
  }

  private async fixResultSyntax<T>(
    ai: Readonly<AI>,
    _mem: AIMemory,
    error: Readonly<Error>,
    value: string,
    { sessionId }: Readonly<GenerateTextExtraOptions>,
    expectedSchema?: Readonly<JSONSchemaType<T>>
  ): Promise<{ fixedValue: string }> {
    let prompt = [
      `Result JSON:\n"""${value}"""`,
      `Syntax error in result JSON:\n${error.message}`,
    ];

    const jschema = JSON.stringify(expectedSchema, null, 2);

    if (expectedSchema) {
      prompt = [
        ...prompt,
        `Expected result must follow below JSON-Schema:\n${jschema}`,
        `Result JSON:`,
      ];
    }

    const res = await ai.generate(prompt.join('\n\n'), this.conf, sessionId);
    const fixedValue = res.results.at(0)?.text?.trim() ?? '';

    if (fixedValue.length === 0) {
      throw { message: 'Empty response received' };
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
    throw { message: 'Expected format is a list of key: value' };
  }
  return vm;
};

function jaccardSimilarity(sentence1: string, sentence2: string) {
  const set1 = new Set(sentence1.split(' '));
  const set2 = new Set(sentence2.split(' '));
  const intersection = new Set([...set1].filter((word) => set2.has(word)));
  const union = new Set([...set1, ...set2]);
  return intersection.size / union.size;
}

function addFuncToTrace(
  trace: Readonly<AIGenerateTextTrace>,
  funcExec: Readonly<FunctionExec>
) {
  trace.response.functions = [...(trace.response.functions ?? []), funcExec];
}
