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
  trimResult?: boolean;
};

export class Agent {
  private readonly ai: AIService;
  private readonly memory: AIMemory;

  private readonly agentPrompt: string;
  private readonly contextLabel: string;
  private readonly trimResult: boolean;
  private readonly agentFuncs: Readonly<AITextRequestFunction>[];

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
    this.trimResult = options?.trimResult ?? false;
  }

  agentRequest = (
    item: readonly AITextChatPromptItem[]
  ): Readonly<AITextChatRequest> => ({
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

    if (this.trimResult) {
      history = history.map((v) =>
        v.role === 'function' ? { ...v, text: 'success' } : v
      );
    }

    const req = this.agentRequest([...history, item]);

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
