import { GenerateTextResponse } from '../ai/types.js';
import { APIError, ParsingError } from '../tracing/types.js';

import {
  finalResultFunc,
  FunctionProcessor,
  functionsToJSON,
} from './functions.js';
import { Memory } from './memory.js';
import { parseResult } from './result.js';
import {
  AIMemory,
  AIPromptConfig,
  AIService,
  AIServiceActionOptions,
  AITextResponse,
  PromptConfig,
  PromptFunction,
} from './types.js';
import { uuid } from './util.js';

export type Options = {
  memory?: AIMemory;
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

    if (this.functions.length > 0 && this.conf.response?.schema) {
      this.functions = [
        ...this.functions,
        finalResultFunc(this.conf.response?.schema),
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
    options: Readonly<Options & AIServiceActionOptions> = {}
  ): Promise<AITextResponse<string | Map<string, string[]> | T>> {
    ai.setOptions({ debug: this.debug, disableLog: true });
    const { sessionId, memory } = options;
    const { stopSequences } = this.conf;
    const traceId = options.traceId ?? uuid();

    const [, value] = await this._generate(ai, memory || new Memory(), query, {
      ...options,
      traceId,
      stopSequences,
    });

    return {
      sessionId,
      prompt: query,
      value: () => value,
    };
  }

  private async _generate(
    ai: AIService,
    mem: AIMemory,
    query: string,
    options: Readonly<AIPromptConfig & AIServiceActionOptions>
  ): Promise<[GenerateTextResponse, string | Map<string, string[]> | T]> {
    try {
      return await this.generateHandler(ai, mem, query, options);
    } catch (e: unknown) {
      const err = e as APIError | ParsingError | Error;

      if ((err as APIError).request) {
        ai.getTraceResponse()?.setApiError(err as APIError);
      }

      if ((err as ParsingError).value) {
        ai.getTraceResponse()?.setParsingError(err as ParsingError);
      }

      throw err as Error;
    } finally {
      if (ai.traceExists()) {
        ai.logTrace();
      }
    }
  }

  private async generateHandler(
    ai: AIService,
    mem: AIMemory,
    query: string,
    options: Readonly<AIPromptConfig & AIServiceActionOptions>
  ): Promise<[GenerateTextResponse, string | Map<string, string[]> | T]> {
    const { keyValue = false, schema } = this.conf.response || {};

    let res: GenerateTextResponse;
    let value: string;

    if (this.functions && this.functions?.length > 0) {
      [res, value] = await this.generateWithFunctions(ai, mem, query, options);
    } else {
      [res, value] = await this.generateDefault(ai, mem, query, options);
    }

    const finalValue = await parseResult<T>(
      ai,
      options,
      value,
      keyValue,
      schema
    );
    return [res, finalValue];
  }

  private async generateWithFunctions(
    ai: AIService,
    mem: AIMemory,
    query: string,
    options: Readonly<AIPromptConfig & AIServiceActionOptions>
  ): Promise<[GenerateTextResponse, string]> {
    const h = () => mem.history(options?.sessionId);
    const funcProcessor = new FunctionProcessor(ai, options);
    let previousValue;

    for (let i = 0; i < this.maxSteps; i++) {
      const p = this.prompt(query, h);
      const res = await ai.generate(p, options);
      const value = res.results.at(0)?.text?.trim() ?? '';

      // check for duplicate responses
      if (previousValue && jaccardSimilarity(previousValue, value) > 0.8) {
        return [res, value];
      }

      // remember current response
      previousValue = value;

      // check for empty responses
      if (value.length === 0) {
        throw { message: `Empty response received`, value };
      }

      // check for functions
      const foundFunc = funcProcessor.parseFunction(value);

      // loop back if no function found
      if (!foundFunc) {
        continue;
      }

      const funcExec = await funcProcessor.processFunction(
        foundFunc.name,
        foundFunc.args,
        this.functions
      );

      const mval = [
        value,
        this.conf.stopSequences?.at(0) ?? '',
        funcExec.result,
      ];
      mem.add(`\n${mval.join('\n')}`, options.sessionId);

      if (foundFunc.name.localeCompare('finalResult') === 0) {
        return [res, funcExec.result ?? ''];
      }
    }

    throw new Error(`max ${this.maxSteps} steps allowed`);
  }

  private async generateDefault(
    ai: AIService,
    mem: AIMemory,
    query: string,
    options: Readonly<AIPromptConfig & AIServiceActionOptions>
  ): Promise<[GenerateTextResponse, string]> {
    const h = () => mem.history(options.sessionId);
    const p = this.prompt(query, h);
    const res = await ai.generate(p, options);
    const value = res.results.at(0)?.text?.trim() ?? '';

    if (value.length === 0) {
      throw { message: 'Empty response received', value };
    }

    const mval = [
      this.conf.queryPrefix,
      query,
      this.conf.responsePrefix,
      value,
    ];
    mem.add(mval.join(''), options.sessionId);
    return [res, value];
  }
}

const jaccardSimilarity = (sentence1: string, sentence2: string) => {
  const set1 = new Set(sentence1.split(' '));
  const set2 = new Set(sentence2.split(' '));
  const intersection = new Set([...set1].filter((word) => set2.has(word)));
  const union = new Set([...set1, ...set2]);
  return intersection.size / union.size;
};
