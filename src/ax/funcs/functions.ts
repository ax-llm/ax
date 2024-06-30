import JSON5 from 'json5';

import type { AxAIServiceActionOptions, AxFunction } from '../ai/types.js';

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
  private funcList: readonly AxFunction[];

  constructor(funcList: readonly AxFunction[]) {
    funcList
      .filter((v) => v.parameters)
      .forEach((v) => validateJSONSchema(v.parameters!));
    this.funcList = funcList;
  }

  private executeFunction = async (
    fnSpec: Readonly<AxFunction>,
    func: Readonly<AxChatResponseFunctionCall>,
    options?: Readonly<AxAIServiceActionOptions>
  ): Promise<AxFunctionExec> => {
    if (!fnSpec.func) {
      throw new Error(`Function handler for ${fnSpec.name} not implemented`);
    }

    let args;

    if (typeof func.args === 'string' && func.args.length > 0) {
      args = JSON5.parse(func.args);
    } else {
      args = func.args;
    }

    const opt = options
      ? {
          sessionId: options.sessionId,
          traceId: options.traceId
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
