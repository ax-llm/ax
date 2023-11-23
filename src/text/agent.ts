import { TextResponse } from '../ai';
import {
  AITextChatPromptItem,
  AITextChatRequest,
  AITextRequestFunction
} from '../tracing/types';

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
  functionCall: { name: string; result: string };
};

export type AgentOptions = {
  agentPrompt?: string;
  contextLabel?: string;
  historyUpdater?: HistoryUpdater;
  functionsUpdater?: FunctionsUpdater;
};

export type HistoryUpdater = (
  arg0: Readonly<AITextChatPromptItem>
) => AITextChatPromptItem | null;

export type FunctionsUpdater = (
  arg0: Readonly<AITextChatRequest>
) => Readonly<AITextRequestFunction>[];

export class Agent {
  private readonly ai: AIService;
  private readonly memory: AIMemory;

  private readonly agentPrompt: string;
  private readonly contextLabel: string;
  private readonly agentFuncs: Readonly<AITextRequestFunction>[];
  private readonly historyUpdater?: HistoryUpdater;
  private readonly functionsUpdater?: FunctionsUpdater;

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
    this.functionsUpdater = options?.functionsUpdater;
  }

  agentRequest = (
    item: readonly AITextChatPromptItem[]
  ): AITextChatRequest => ({
    chatPrompt: [{ role: 'system', text: this.agentPrompt }, ...item],
    functions: this.agentFuncs,
    functionCall: 'auto'
  });

  private chat = async (
    item: Readonly<AITextChatPromptItem>,
    traceId: string,
    generateMore: boolean
  ) => {
    let history = this.memory.history(traceId);

    if (this.historyUpdater) {
      history = history
        .map(this.historyUpdater)
        .filter(Boolean) as AITextChatPromptItem[];
    }

    const req = this.agentRequest([...history, item]);

    if (this.functionsUpdater) {
      const res = this.functionsUpdater(req);
      if (res.length === 0) {
        req.functions = undefined;
        req.functionCall = undefined;
      } else {
        req.functions = res;
        req.functionCall = 'auto';
      }
    }

    const res = (await this.ai.chat(req, {
      stopSequences: [],
      traceId,
      cache: true
    })) as TextResponse;
    const result = res.results.at(0);

    if (!result) {
      throw new Error('No result defined in response');
    }

    if (!generateMore) {
      this.memory.add(item, traceId);
    }
    this.memory.addResult(result, traceId);

    if (result.functionCall) {
      return { functionCall: result.functionCall };
    }

    return null;
  };

  start = async (req: Readonly<NewAgentRequest>) => {
    const { traceId, task, context } = req;

    const item = {
      role: 'user',
      text: `Task:\n${task}\n\n${this.contextLabel}:\n${context}`
    };

    try {
      for (let i = 0; i < 3; i++) {
        const generateMore = i > 0;
        if (generateMore) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        const res = await this.chat(item, traceId, generateMore);
        if (res) {
          return res;
        }
      }
    } catch (error) {
      console.error('ERROR', error);
      return { error };
    }

    throw new Error('No function defined in response');
  };

  next = async (traceId: string, req: Readonly<StepAgentRequest>) => {
    const { functionCall } = req;
    const { name, result: text } = functionCall;

    const item = {
      role: 'function',
      name,
      text
    };

    try {
      const res = await this.chat(item, traceId, false);
      return res;
    } catch (error) {
      console.error('ERROR', error);
      return { error };
    }
  };
}
