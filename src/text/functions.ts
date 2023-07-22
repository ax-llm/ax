import {
  AIGenerateTextResponse,
  AIMemory,
  PromptFunction,
  PromptFunctionExtraOptions,
} from './types.js';
import { log, stringToObject } from './util.js';
import { AI } from './wrap.js';

const functionCallRe = /(\w+)\((.*)\)/s;
const queryPrefix = '\nObservation: ';

const executeFunction = async (
  funcInfo: Readonly<PromptFunction>,
  funcArgJSON: string,
  extra: Readonly<PromptFunctionExtraOptions>
): Promise<{ value?: string; error?: string }> => {
  let value;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value = stringToObject<any>(funcArgJSON, funcInfo.inputSchema);
  } catch (e) {
    return { error: (e as Error).message };
  }

  const res =
    (await funcInfo.func.length) === 2
      ? funcInfo.func(value, extra)
      : funcInfo.func(value);

  return { value: JSON.stringify(res, null, '\t') };
};

export const processFunction = async (
  functions: readonly PromptFunction[],
  ai: Readonly<AI>,
  mem: AIMemory,
  res: Readonly<AIGenerateTextResponse<string>>,
  debug = false,
  sessionID?: string
): Promise<{ done: boolean }> => {
  let funcName = '';
  let funcArgs = '';
  let v: string[] | null;

  const val = res.value();

  if ((v = functionCallRe.exec(val)) !== null) {
    funcName = v[1].trim();
    funcArgs = v[2].trim();
  }

  if (funcName === 'finalResult') {
    mem.add(val, sessionID);
    res.values[0].text = funcArgs;
    return { done: true };
  }

  let funcResult;
  const func = functions.find((v) => v.name === funcName);

  if (!func) {
    funcResult = `Function ${funcName} not found`;
  }

  if (func) {
    const result = await executeFunction(func, funcArgs, {
      ai,
      debug,
      sessionID,
    });

    if (result.error) {
      funcResult = `Fix error and repeat action: ${result.error}`;
    } else {
      funcResult = result.value;
    }
  }

  if (!funcResult || funcResult.length === 0) {
    funcResult = `No data returned by function`;
  }

  if (debug) {
    log(`> ${funcName}(${funcArgs}): ${funcResult}`, 'cyan');
  }

  const mval = ['\n', val, queryPrefix, funcResult];
  mem.add(mval.join(''), sessionID);

  return { done: false };
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
