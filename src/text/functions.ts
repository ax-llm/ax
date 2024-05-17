import JSON5 from 'json5';

import type { TextResponseFunctionCall } from '../ai/types.js';

import type { AIServiceActionOptions, FunctionExec } from './types.js';
import { validateJSONSchema } from './jsonschema.js';

export type AITextFunctionHandler = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args?: any,
  extra?: Readonly<AIServiceActionOptions>
) => unknown;

export type FunctionJSONSchema = {
  type: string;
  properties?: Record<
    string,
    FunctionJSONSchema & {
      enum?: string[];
      default?: unknown;
      description: string;
    }
  >;
  required?: string[];
  items?: FunctionJSONSchema;
};

export type AITextFunction = {
  name: string;
  description: string;
  parameters?: FunctionJSONSchema;
  func?: AITextFunctionHandler;
};

export class FunctionProcessor {
  private funcList: readonly AITextFunction[];

  constructor(funcList: readonly AITextFunction[]) {
    funcList
      .filter((v) => v.parameters)
      .forEach((v) => validateJSONSchema(v.parameters!));
    this.funcList = funcList;
  }

  private executeFunction = async (
    fnSpec: Readonly<AITextFunction>,
    func: Readonly<TextResponseFunctionCall>,
    options?: Readonly<AIServiceActionOptions>
  ): Promise<FunctionExec> => {
    if (!fnSpec.func) {
      throw new Error(`Function handler for ${fnSpec.name} not implemented`);
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
    func: Readonly<TextResponseFunctionCall>,
    options?: Readonly<AIServiceActionOptions>
  ): Promise<FunctionExec> => {
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
    const funcExec = await this.executeFunction(fnSpec, func, options);

    // // signal error if no data returned
    // if (!funcExec.result || funcExec.result.length === 0) {
    //   funcExec.result = `No data returned by function`;
    // }
    return funcExec;
  };
}
