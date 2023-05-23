import {
  AIService,
  AIMemory,
  PromptConfig,
  PromptAction,
  AIGenerateTextResponse,
} from './index';

import { log } from './util';

const actionNameRe = /(^|\s)Action:\s{0,}\n?([^\.\n]+)/m;
const actionValueRe = /^Action Input:\s{0,}\n?(.+)$/ms;
const finalValueRe = /^Final Answer:\s{0,}\n?(.+)$/ms;
const queryPrefix = '\nObservation: ';
const responsePrefix = '\nThought: ';

export const processAction = async (
  conf: PromptConfig,
  ai: AIService,
  mem: AIMemory,
  res: AIGenerateTextResponse<string>,
  { sessionID, debug = false }: { sessionID?: string; debug: boolean }
): Promise<boolean> => {
  const { actions } = conf;

  let actKey: string;
  let actVal: string;
  let v: string[] | null;

  const val = res.value().trim();

  if ((v = finalValueRe.exec(val)) !== null) {
    const mval = [responsePrefix, val];
    mem.add(mval.join(''), sessionID);
    res.values[0].text = v[1].trim();
    return true;
  }

  if ((v = actionNameRe.exec(val)) !== null) {
    actKey = v[2].trim();
  }
  if ((v = actionValueRe.exec(val)) !== null) {
    actVal = v[1].trim();
  }

  const act = actions.find((v) => v.name === actKey);
  if (!act) {
    throw new Error(`invalid action found: "${actKey}", response: "${val}"`);
  }

  const actRes =
    act.action.length === 2
      ? act.action(actVal, await ai.embed([actVal], sessionID))
      : act.action(actVal);

  if (debug) {
    log(`> ${actKey}(${actVal}): ${actRes}`, 'cyan');
  }

  const mval = [responsePrefix, val, queryPrefix, actRes];
  mem.add(mval.join(''), sessionID);
  return false;
};

export const buildActionsPrompt = (
  actions: PromptAction[],
  finalAnswerFormat?: string
): string => {
  const actn = actions.map((v) => v.name).join(', ');
  const actd = actions.map((v) => `${v.name}: ${v.description}`).join('\n');
  let faf: string = ``;

  if (finalAnswerFormat && finalAnswerFormat.length > 0) {
    faf = `Final Answer Format: ${finalAnswerFormat}`;
  }

  return `
Think step-by-step using the actions below.

Actions Available:
${actd}

Format:
Thought: Always consider what to do.
Action: The action to take, choose from [${actn}].
Action Input: The input required for the action.
Observation: The output of the action.

Thought: I now have additional information.
Repeat the previous four steps as necessary.

Thought: I have the final answer.
Final Answer: The answer to the original question.
${faf}

Start!\n`;
};
