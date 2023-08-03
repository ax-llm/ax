import {
  FunctionExec,
  PromptFunction,
  PromptFunctionExtraOptions,
} from './types.js';
import { stringToObject } from './util.js';
import { AI } from './wrap.js';

const functionCallRe = /(\w+)\((.*)\)/s;
const thoughtRe = /Thought:(.*)$/gm;

const executeFunction = async (
  funcInfo: Readonly<PromptFunction>,
  funcArgJSON: string,
  extra: Readonly<PromptFunctionExtraOptions>
): Promise<FunctionExec> => {
  let args;

  if (funcInfo.inputSchema === undefined) {
    const res =
      funcInfo.func.length === 1
        ? await funcInfo.func(extra)
        : await funcInfo.func();
    return {
      name: funcInfo.name,
      result: JSON.stringify(res, null, 2),
      resultValue: res,
    };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args = stringToObject<any>(funcArgJSON, funcInfo.inputSchema);
  } catch (e) {
    return {
      name: funcInfo.name,
      parsingError: { error: (e as Error).message, data: funcArgJSON },
    };
  }

  const res =
    funcInfo.func.length === 2
      ? await funcInfo.func(args, extra)
      : await funcInfo.func(args);

  return {
    name: funcInfo.name,
    args,
    result: JSON.stringify(res, null, 2),
    resultValue: res,
  };
};

export const processFunction = async (
  value: string,
  functions: readonly PromptFunction[],
  ai: Readonly<AI>,
  sessionId?: string
): Promise<FunctionExec> => {
  let funcName = '';
  let funcArgs = '';
  let v: string[] | null;

  // extract thoughts
  const tm = value.matchAll(thoughtRe);
  const reasoning: string[] = [];

  for (const m of tm) {
    reasoning.push(m[1].trim());
  }

  // extract function calls
  if ((v = functionCallRe.exec(value)) !== null) {
    funcName = v[1].trim();
    funcArgs = v[2].trim();
  }

  const func = functions.find((v) => v.name.localeCompare(funcName) === 0);

  // add {} to object args if missing
  if (
    func?.inputSchema?.type === 'object' &&
    !funcArgs.startsWith('{') &&
    !funcArgs.startsWith('[')
  ) {
    funcArgs = `{${funcArgs}}`;
  }

  let funcExec: FunctionExec = { name: funcName, reasoning };

  if (!func) {
    funcExec.result = `Function ${funcName} not found`;
    return funcExec;
  }

  // return final result
  if (funcName.localeCompare('finalResult') === 0) {
    funcExec.result = funcArgs;
    return funcExec;
  }

  // execute value function calls
  if (func) {
    funcExec = await executeFunction(func, funcArgs, {
      ai,
      sessionId,
    });

    if (funcExec.parsingError) {
      funcExec.result = `Fix error and repeat: ${funcExec.parsingError.error}`;
    } else if (!funcExec.result || funcExec.result.length === 0) {
      funcExec.result = `No data returned by function`;
    }
  }

  return funcExec;
};

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
