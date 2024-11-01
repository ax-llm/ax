import JSON5 from 'json5';

import type {
  AxAIService,
  AxAIServiceActionOptions,
  AxChatResponseResult,
  AxFunction
} from '../ai/types.js';
import type { AxMemory } from '../mem/memory.js';

import { validateJSONSchema } from './jsonschema.js';

export type AxChatResponseFunctionCall = {
  id?: string;
  name: string;
  args: string;
};

export type AxFunctionExec = {
  id?: string;
  result?: string;
};

export class AxFunctionProcessor {
  private funcList: Readonly<AxFunction[]> = [];

  constructor(funcList: Readonly<AxFunction[]>) {
    this.funcList = funcList;
  }

  private executeFunction = async (
    fnSpec: Readonly<AxFunction>,
    func: Readonly<AxChatResponseFunctionCall>,
    options?: Readonly<AxAIServiceActionOptions>
  ): Promise<AxFunctionExec> => {
    let args;

    if (typeof func.args === 'string' && func.args.length > 0) {
      args = JSON5.parse(func.args);
    } else {
      args = func.args;
    }

    const opt = options
      ? {
          sessionId: options.sessionId,
          traceId: options.traceId,
          ai: options.ai
        }
      : undefined;

    if (!fnSpec.parameters) {
      const res =
        fnSpec.func.length === 1 ? await fnSpec.func(opt) : await fnSpec.func();

      return {
        id: func.id,
        result: JSON.stringify(res, null, 2)
      };
    }

    const res =
      fnSpec.func.length === 2
        ? await fnSpec.func(args, opt)
        : await fnSpec.func(args);

    return {
      id: func.id,
      result: JSON.stringify(res, null, 2)
    };
  };

  public execute = async (
    func: Readonly<AxChatResponseFunctionCall>,
    options?: Readonly<AxAIServiceActionOptions>
  ): Promise<AxFunctionExec> => {
    const fnSpec = this.funcList.find(
      (v) => v.name.localeCompare(func.name) === 0
    );
    if (!fnSpec) {
      throw new Error(`Function not found: ` + func.name);
    }
    if (!fnSpec.func) {
      throw new Error('No handler for function: ' + func.name);
    }

    // execute value function calls
    return await this.executeFunction(fnSpec, func, options);
  };
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export type InputFunctionType =
  | AxFunction[]
  | {
      toFunction: () => AxFunction;
    }[];

// eslint-disable-next-line @typescript-eslint/naming-convention
export const parseFunctions = (
  newFuncs: Readonly<InputFunctionType>,
  existingFuncs?: readonly AxFunction[]
): AxFunction[] => {
  if (newFuncs.length === 0) {
    return [...(existingFuncs ?? [])];
  }

  const functions = newFuncs.map((f) => {
    if ('toFunction' in f) {
      return f.toFunction();
    }
    return f;
  });

  for (const fn of functions.filter((v) => v.parameters)) {
    validateJSONSchema(fn.parameters!);
  }

  return [...(existingFuncs ?? []), ...functions];
};

// eslint-disable-next-line @typescript-eslint/naming-convention
export const processFunctions = async (
  ai: Readonly<AxAIService>,
  functionList: Readonly<AxFunction[]>,
  functionCalls: readonly AxChatResponseFunctionCall[],
  mem: Readonly<AxMemory>,
  sessionId?: string,
  traceId?: string
) => {
  const funcProc = new AxFunctionProcessor(functionList);

  // Map each function call to a promise that resolves to the function result or null
  const promises = functionCalls.map((func) =>
    funcProc?.execute(func, { sessionId, traceId, ai }).then((fres) => {
      if (fres?.id) {
        return {
          role: 'function' as const,
          result: fres.result ?? '',
          functionId: fres.id
        };
      }
      return null; // Returning null for function calls that don't meet the condition
    })
  );

  // Wait for all promises to resolve
  const results = await Promise.all(promises);

  results.forEach((result) => {
    if (result) {
      mem.add(result, sessionId);
    }
  });
};

// eslint-disable-next-line @typescript-eslint/naming-convention
export function parseFunctionCalls(
  ai: Readonly<AxAIService>,
  functionCalls: Readonly<AxChatResponseResult['functionCalls']>,
  values: Record<string, unknown>,
  model?: string
): AxChatResponseFunctionCall[] | undefined {
  if (!functionCalls || functionCalls.length === 0) {
    return;
  }
  if (ai.getFeatures(model).functions) {
    const funcs: AxChatResponseFunctionCall[] = functionCalls.map((f) => ({
      id: f.id,
      name: f.function.name,
      args: f.function.params as string
    }));

    // for (const [i, f] of funcs.entries()) {
    //   values['functionName' + i] = f.name;
    //   values['functionArguments' + i] =
    //     typeof f.args === 'object' ? JSON.stringify(f.args) : f.args;
    // }
    return funcs;
  } else if (values['functionName']) {
    const { functionName, functionArguments } = values as {
      functionName: string;
      functionArguments: string;
      other: object;
    };
    delete values['functionName'];
    delete values['functionArguments'];

    return [
      {
        name: functionName,
        args: functionArguments
      }
    ];
  }
}
