import {
  FunctionExec,
  PromptFunction,
  PromptFunctionExtraOptions,
} from './types.js';
import { log, stringToObject } from './util.js';
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
      response: JSON.stringify(res, null, '\t'),
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
    response: JSON.stringify(res, null, '\t'),
  };
};

export const processFunction = async (
  value: string,
  functions: readonly PromptFunction[],
  ai: Readonly<AI>,
  debug = false,
  sessionID?: string
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

  let funcExec: FunctionExec = { name: funcName, reasoning };

  if (funcName === 'finalResult') {
    funcExec.response = funcArgs;
    return funcExec;
  }

  const func = functions.find((v) => v.name === funcName);

  // execute value function calls
  if (func) {
    funcExec = await executeFunction(func, funcArgs, {
      ai,
      debug,
      sessionID,
    });

    if (funcExec.parsingError) {
      funcExec.response = `Fix error and repeat: ${funcExec.parsingError.error}`;
    } else if (!funcExec.response || funcExec.response.length === 0) {
      funcExec.response = `No data returned by function`;
    }
  } else {
    funcExec.response = `Function ${funcName} not found`;
  }

  if (debug) {
    log(`> ${funcName}(${funcArgs}): ${funcExec.response}`, 'cyan');
  }
  return funcExec;
};

export const buildFunctionsPrompt = (
  functions: readonly PromptFunction[]
): string => {
  const funcList = functions.map((v) => ({
    name: v.name,
    description: v.description,
    parameters: v.inputSchema,
  }));

  const functionsJSON = JSON.stringify(funcList, null, '\t');

  return `
Functions:
${functionsJSON}

Solve the below task. Think step-by-step using the functions above.

Format:
Thought: Consider what to do.
Function Call: functionName(arguments)
Observation: Function output
Thought: I now have additional information.
Repeat the previous four steps as necessary.

Thought: I have the final answer.
Function Call: finalResult(arguments)

Task:`;
};
