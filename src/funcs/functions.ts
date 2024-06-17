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
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args?: any;
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
      throw new Error(`AxFunction handler for ${fnSpec.name} not implemented`);
    }

    let argOBj;
    if (func.args && func.args.length > 0) {
      argOBj = JSON5.parse(func.args);
    }

    if (!fnSpec.parameters) {
      const res =
        fnSpec.func.length === 1
          ? await fnSpec.func(options)
          : await fnSpec.func();

      return {
        name: fnSpec.name,
        result: JSON.stringify(res, null, 2)
      };
    }

    const res =
      fnSpec.func.length === 2
        ? await fnSpec.func(argOBj, options)
        : await fnSpec.func(argOBj);

    return {
      id: func.id,
      name: func.name,
      args: func.args,
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
      throw new Error(`AxFunction not found: ` + func.name);
    }
    if (!fnSpec.func) {
      throw new Error('No handler for function: ' + func.name);
    }

    // execute value function calls
    const funcExec = await this.executeFunction(fnSpec, func, options);

    // // signal error if no data returned
    // if (!funcExec.result || funcExec.result.length === 0) {
    //   funcExec.result = `No data returned by function`;
    // }
    return funcExec;
  };
}
