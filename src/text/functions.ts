import { parseResult } from './result.js';
import {
  AIGenerateTextTraceStep,
  AIPromptConfig,
  AIService,
  FunctionExec,
  FuncTrace,
  GenerateTextExtraOptions,
  PromptFunction,
} from './types.js';

const functionCallRe = /(\w+)\((.*)\)/s;
// const thoughtRe = /Thought:(.*)$/gm;

export class FunctionProcessor {
  private ai: AIService;
  private conf: Readonly<AIPromptConfig>;
  private options: Readonly<GenerateTextExtraOptions>;

  constructor(
    ai: AIService,
    conf: Readonly<AIPromptConfig>,
    options: Readonly<GenerateTextExtraOptions>
  ) {
    this.ai = ai;
    this.conf = conf;
    this.options = options;
  }

  private executeFunction = async <T>(
    funcInfo: Readonly<PromptFunction>,
    funcArgJSON: string
  ): Promise<FunctionExec> => {
    const extra = { ai: this.ai, session: this.options };

    if (!funcInfo.inputSchema) {
      const res =
        funcInfo.func.length === 1
          ? await funcInfo.func(extra)
          : await funcInfo.func();
      return {
        name: funcInfo.name,
        result: JSON.stringify(res, null, 2),
      };
    }

    const funcArgs = await parseResult<T>(
      this.ai,
      this.conf,
      this.options,
      funcArgJSON,
      false,
      funcInfo.inputSchema
    );

    const res =
      funcInfo.func.length === 2
        ? await funcInfo.func(funcArgs, extra)
        : await funcInfo.func(funcArgs);

    return {
      name: funcInfo.name,
      args: funcArgs,
      result: JSON.stringify(res, null, 2),
    };
  };

  public parseFunction = (
    value: string
  ): { name: string; args: string } | undefined => {
    let v: string[] | null;

    // extract function calls
    if ((v = functionCallRe.exec(value)) !== null) {
      return {
        name: v[1].trim(),
        args: v[2].trim(),
      };
    }
    return;
  };

  public processFunction = async (
    funcName: string,
    funcArgs: string,
    functions: readonly PromptFunction[]
  ): Promise<FunctionExec> => {
    // extract thoughts
    // const tm = value.matchAll(thoughtRe);
    // const reasoning: string[] = [];

    // for (const m of tm) {
    //   reasoning.push(m[1].trim());
    // }

    const func = functions.find((v) => v.name.localeCompare(funcName) === 0);

    // add {} to object args if missing
    if (
      func?.inputSchema?.type === 'object' &&
      !funcArgs.startsWith('{') &&
      !funcArgs.startsWith('[')
    ) {
      funcArgs = `{${funcArgs}}`;
    }

    const step = this.ai.getTraceStep() as AIGenerateTextTraceStep;
    const funcTrace: FuncTrace = {
      name: funcName,
      args: funcArgs,
    };

    let funcExec: FunctionExec = { name: funcName };

    if (!func) {
      funcExec.result = `Function ${funcName} not found`;
      return funcExec;
    }

    if (step) {
      if (!step.response.functions) {
        step.response.functions = [];
      }

      step.response.functions.push(funcTrace);
    }

    // execute value function calls
    funcExec = await this.executeFunction(func, funcArgs);

    // signal error if no data returned
    if (!funcExec.result || funcExec.result.length === 0) {
      funcExec.result = `No data returned by function`;
    }

    if (step) {
      funcTrace.result = funcExec.result;
    }

    return funcExec;
  };
}

export const functionsToJSON = (
  functions: readonly PromptFunction[]
): string => {
  const funcList = functions.map((v) => ({
    name: v.name,
    description: v.description,
    parameters: v.inputSchema,
  }));

  return JSON.stringify(funcList, null, 2);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const finalResultFunc = (schema: any): PromptFunction => ({
  name: 'finalResult',
  description: 'Return the final result',
  inputSchema: schema ?? {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  func: async (arg0: any) => arg0,
});
