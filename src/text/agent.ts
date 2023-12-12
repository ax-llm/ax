import {
  TextResponse,
  TextResponseFunctionCall,
  TextResponseResult
} from '../ai';
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

export type AgentResponse<T> = {
  functionCall?: TextResponseFunctionCall;
  response: T;
};

export type AgentOptions<T> = {
  agentPrompt?: string;
  contextLabel?: string;
  extractMatch?: ExtractMatch;
  historyUpdater?: HistoryUpdater;
  responseHandler?: ResponseHandler<T>;
  cache?: boolean;
};

export type HistoryUpdater = (
  chatPromptItem: Readonly<AITextChatPromptItem>
) => AITextChatPromptItem | null;

export type ResponseHandlerResponse<T> = {
  response: T;
  appendText?: string;
};

export type ResponseHandler<T> = (
  value: string,
  traceId?: string
) => ResponseHandlerResponse<T> | Promise<ResponseHandlerResponse<T>>;

export type ExtractMatch = { pattern: RegExp; notFoundPrompt: string };

export class Agent<T = string> {
  private readonly ai: AIService;
  private readonly memory: AIMemory;

  private readonly agentPrompt: string;
  private readonly contextLabel: string;
  private readonly extractMatch?: ExtractMatch;
  private readonly agentFuncs: Readonly<AITextRequestFunction>[];
  private readonly historyUpdater?: HistoryUpdater;
  private readonly responseHandler?: ResponseHandler<T>;
  private readonly cache: boolean;

  constructor(
    ai: AIService,
    memory: Readonly<AIMemory>,
    // eslint-disable-next-line functional/prefer-immutable-types
    agentFuncs: Readonly<AITextRequestFunction>[],
    options?: Readonly<AgentOptions<T>>
  ) {
    this.ai = ai;
    this.memory = memory;
    this.agentFuncs = agentFuncs;
    this.contextLabel = options?.contextLabel ?? 'Context';
    this.extractMatch = options?.extractMatch;
    this.agentPrompt = options?.agentPrompt ?? agentPrompt;
    this.historyUpdater = options?.historyUpdater;
    this.responseHandler = options?.responseHandler;
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
  ): Promise<AgentResponse<T>> => {
    const chatPrompt = { ...item } as AITextChatPromptItem;

    let functionCall: TextResponseFunctionCall | undefined;
    let resBuff = '';
    let response: T;

    for (let i = 0; i < 5; i++) {
      const res = await this._chat(chatPrompt, traceId, i == 0);
      resBuff += res.text;

      if (res.finishReason === 'length') {
        continue;
      }

      if (this.extractMatch) {
        const match = this.extractMatch.pattern.exec(resBuff);

        if (!match || !match[1] || match[1].trim().length === 0) {
          // throw new Error('Failed to extract match from: ' + resBuff);
          chatPrompt.text = this.extractMatch.notFoundPrompt;
          continue;
        }
        resBuff = match[1].trim();
      }

      if (this.agentFuncs?.length > 0 && !res.functionCall) {
        throw new Error('No function in response');
      }

      functionCall = res.functionCall;

      if (this.responseHandler) {
        try {
          const res = await this.responseHandler(resBuff, traceId);
          const { appendText: text } = res;

          if (text && text.length > 0) {
            this.memory.add({ text, role: 'assistant' }, traceId);
          }

          response = res.response;
        } catch (e) {
          chatPrompt.text = `Please fix the following error: ${
            (e as Error).message
          }`;
          continue;
        }
      } else {
        response = resBuff as T;
      }

      return { response, functionCall };
    }

    throw new Error('Failed to get valid response from AI');
  };

  private _chat = async (
    item: Readonly<AITextChatPromptItem>,
    traceId: string,
    notContinued: boolean
  ): Promise<TextResponseResult> => {
    let history = this.memory.history(traceId);

    if (this.historyUpdater && notContinued) {
      history = history
        .map(this.historyUpdater)
        .filter(Boolean) as AITextChatPromptItem[];
    }

    const req = this.agentRequest(notContinued ? [...history, item] : history);

    const res = (await this.ai.chat(req, {
      stopSequences: [],
      traceId,
      cache: this.cache
    })) as TextResponse;
    const result = res.results.at(0);

    if (!result) {
      throw new Error('No result defined in response');
    }

    if (notContinued) {
      this.memory.add(item, traceId);
    }

    this.memory.addResult(result, traceId);
    return result;
  };

  start = async (req: Readonly<NewAgentRequest>): Promise<AgentResponse<T>> => {
    const { traceId, task, context } = req;

    const item = {
      role: 'user',
      text: `Task:\n${task}\n\n${this.contextLabel}:\n${context}`
    };

    try {
      return await this.chat(item, traceId);
    } catch (e) {
      await sleep(500);
      throw e;
    }
  };

  next = async (
    traceId: string,
    req: Readonly<StepAgentRequest>
  ): Promise<AgentResponse<T>> => {
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
      return await this.chat(item, traceId);
    } catch (e) {
      await sleep(500);
      throw e;
    }
  };
}
