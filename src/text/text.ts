import {
  finalResultFunc,
  FunctionProcessor,
  functionsToJSON,
} from './functions.js';
import { Memory } from './memory.js';
import { parseResult } from './result.js';
import {
  AIGenerateTextTraceStep,
  AIMemory,
  AIService,
  AITextResponse,
  APIError,
  GenerateTextExtraOptions,
  GenerateTextResponse,
  ParsingError,
  PromptConfig,
  PromptFunction,
} from './types.js';
import { AI, RateLimiterFunction } from './wrap.js';

export type Options = {
  sessionId?: string;
  memory?: AIMemory;
  rateLimiter?: RateLimiterFunction;
  apiKey?: string;
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
    { sessionId, memory, rateLimiter, apiKey }: Options = {}
  ): Promise<AITextResponse<string | Map<string, string[]> | T>> {
    const wai = new AI(ai, this.conf.log, rateLimiter, apiKey);
    const [, value] = await this._generate(
      wai,
      memory || new Memory(),
      query,
      sessionId
    );
    const traces = wai.getTraceSteps();

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
  ): Promise<[GenerateTextResponse, string | Map<string, string[]> | T]> {
    try {
      return await this.generateHandler(ai, mem, query, sessionId);
    } catch (e: unknown) {
      const step = ai.getTraceStep() as AIGenerateTextTraceStep;
      const err = e as APIError | ParsingError | Error;

      if (step && step.response) {
        if ((err as APIError).request) {
          step.response.apiError = err as APIError;
        }
        if ((err as ParsingError).value) {
          step.response.parsingError = err as ParsingError;
        }
      }
      throw err as Error;
    } finally {
      if (this.debug) {
        ai.consoleLogTrace();
      }
      ai.logTrace();
    }
  }

  private async generateHandler(
    ai: Readonly<AI>,
    mem: AIMemory,
    query: string,
    sessionId?: string
  ): Promise<[GenerateTextResponse, string | Map<string, string[]> | T]> {
    const { stopSequences } = this.conf;
    const { keyValue = false, schema } = this.conf.response || {};

    const options = {
      sessionId,
    };

    let res: GenerateTextResponse;
    let value: string;

    if (this.functions && this.functions?.length > 0) {
      [res, value] = await this.generateWithFunctions(ai, mem, query, options);
    } else {
      [res, value] = await this.generateDefault(ai, mem, query, options);
    }

    const finalValue = await parseResult<T>(
      ai,
      { stopSequences },
      options,
      value,
      keyValue,
      schema
    );
    return [res, finalValue];
  }

  private async generateWithFunctions(
    ai: Readonly<AI>,
    mem: AIMemory,
    query: string,
    { sessionId }: Readonly<GenerateTextExtraOptions>
  ): Promise<[GenerateTextResponse, string]> {
    const { stopSequences } = this.conf;
    const h = () => mem.history(sessionId);

    const funcProcessor = new FunctionProcessor(
      ai,
      { stopSequences },
      { sessionId }
    );

    let previousValue;

    for (let i = 0; i < this.maxSteps; i++) {
      const p = this.prompt(query, h);
      const res = await ai.generate(p, { stopSequences }, sessionId);
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

      const step = ai.getTraceStep() as AIGenerateTextTraceStep;
      if (step) {
        step.response.embedModelUsage = res.embedModelUsage;
      }

      const mval = [
        value,
        this.conf.stopSequences?.at(0) ?? '',
        funcExec.result,
      ];
      mem.add(`\n${mval.join('\n')}`, sessionId);

      if (foundFunc.name.localeCompare('finalResult') === 0) {
        return [res, funcExec.result ?? ''];
      }
    }

    throw new Error(`max ${this.maxSteps} steps allowed`);
  }

  private async generateDefault(
    ai: Readonly<AI>,
    mem: AIMemory,
    query: string,
    { sessionId }: Readonly<GenerateTextExtraOptions>
  ): Promise<[GenerateTextResponse, string]> {
    const { stopSequences } = this.conf;
    const h = () => mem.history(sessionId);
    const p = this.prompt(query, h);
    const res = await ai.generate(p, { stopSequences }, sessionId);
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
    mem.add(mval.join(''), sessionId);
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
