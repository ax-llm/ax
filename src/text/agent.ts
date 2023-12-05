import { TextResponse } from '../ai';
import {
  AITextChatPromptItem,
  AITextChatRequest,
  AITextRequestFunction
} from '../tracing/types';
import { sleep } from '../util/other';

import { AIMemory, AIService } from './types';

const agentPrompt = `
Think step-by-step. Use functions. Do not create new functions. Stick to the defined format and function schemas.

Format:
1. Thought: Consider what to do.
2. functionName(parameters in json)
3. Result: Function result.
4. Thought: Analyze result and plan next.
Repeat steps 1-4 until nearing solution.
Finally:

Thought: Prepare the final result.
`;

export type NewAgentRequest = {
  traceId: string;
  task: string;
  context: string;
};

export type StepAgentRequest = {
  functionCall?: { name: string; result: string };
  response?: string;
};

export type AgentOptions = {
  agentPrompt?: string;
  contextLabel?: string;
  historyUpdater?: HistoryUpdater;
  cache?: boolean;
};

export type HistoryUpdater = (
  arg0: Readonly<AITextChatPromptItem>
) => AITextChatPromptItem | null;

export class Agent {
  private readonly ai: AIService;
  private readonly memory: AIMemory;

  private readonly agentPrompt: string;
  private readonly contextLabel: string;
  private readonly agentFuncs: Readonly<AITextRequestFunction>[];
  private readonly historyUpdater?: HistoryUpdater;
  private readonly cache: boolean;

  constructor(
    ai: AIService,
    memory: Readonly<AIMemory>,
    // eslint-disable-next-line functional/prefer-immutable-types
    agentFuncs: Readonly<AITextRequestFunction>[],
    options?: Readonly<AgentOptions>
  ) {
    this.ai = ai;
    this.memory = memory;
    this.agentFuncs = agentFuncs;
    this.contextLabel = options?.contextLabel ?? 'Context';
    this.agentPrompt = options?.agentPrompt ?? agentPrompt;
    this.historyUpdater = options?.historyUpdater;
    this.cache = options?.cache ?? false;
  }

  agentRequest = (
    item: readonly AITextChatPromptItem[]
  ): AITextChatRequest => ({
    chatPrompt: [{ role: 'system', text: this.agentPrompt }, ...item],
    functions: this.agentFuncs?.length === 0 ? undefined : this.agentFuncs,
    functionCall: this.agentFuncs?.length === 0 ? undefined : 'auto'
  });

  private chat = async (
    item: Readonly<AITextChatPromptItem>,
    traceId: string
  ) => {
    let response = '';
    for (let i = 0; i < 10; i++) {
      const res = await this._chat(item, traceId, i > 0);
      response += res.text;

      if (res.finishReason === 'length') {
        continue;
      }

      if (this.agentFuncs?.length > 0 && !res.functionCall) {
        throw new Error('No function in response');
      }

      if (res.functionCall) {
        return { response, functionCall: res.functionCall };
      }

      break;
    }
    return { response };
  };

  private _chat = async (
    item: Readonly<AITextChatPromptItem>,
    traceId: string,
    continued: boolean
  ) => {
    let history = this.memory.history(traceId);

    if (this.historyUpdater) {
      history = history
        .map(this.historyUpdater)
        .filter(Boolean) as AITextChatPromptItem[];
    }

    const req = this.agentRequest([...history, item]);

    const res = (await this.ai.chat(req, {
      stopSequences: [],
      traceId,
      cache: this.cache
    })) as TextResponse;
    const result = res.results.at(0);

    if (!result) {
      throw new Error('No result defined in response');
    }

    if (!continued) {
      this.memory.add(item, traceId);
    }

    this.memory.addResult(result, traceId);
    return result;
  };

  start = async (req: Readonly<NewAgentRequest>) => {
    const { traceId, task, context } = req;

    const item = {
      role: 'user',
      text: `Task:\n${task}\n\n${this.contextLabel}:\n${context}`
    };

    try {
      return this.chat(item, traceId);
    } catch (e) {
      await sleep(500);
      throw e;
    }
  };

  next = async (traceId: string, req: Readonly<StepAgentRequest>) => {
    let item: AITextChatPromptItem;

    if (req.functionCall) {
      const { name, result: text } = req.functionCall;
      item = {
        role: 'function',
        name,
        text
      };
    } else if (req.response) {
      item = {
        role: 'user',
        text: req.response
      };
    } else {
      throw new Error('No functionCall or response defined');
    }

    try {
      return this.chat(item, traceId);
    } catch (e) {
      await sleep(500);
      throw e;
    }
  };
}
