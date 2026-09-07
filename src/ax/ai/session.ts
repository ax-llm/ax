import type {
  AxAIServiceOptions,
  AxChatResponse,
  AxFunctionResult,
} from './types.js';

/** Normalized events for a single provider-pinned conversation. */
export type AxChatSessionEvent =
  | { type: 'response'; response: AxChatResponse; responseId: string }
  | { type: 'response.completed'; response: AxChatResponse; responseId: string }
  | {
      type: 'tool.call';
      responseId: string;
      call: NonNullable<
        AxChatResponse['results'][number]['functionCalls']
      >[number];
    }
  | {
      type: 'steering';
      status: 'accepted' | 'pending' | 'failed';
      steerId?: string;
      requiredCallIds?: readonly string[];
      responseId?: string;
      error?: string;
    };

/** Optional AxAI capability. The caller owns execution; providers own transport. */
export interface AxChatSession {
  readonly model: string;
  /** Aborts when the transport closes or fails, including between responses. */
  readonly signal?: AbortSignal;
  events(): AsyncIterable<AxChatSessionEvent>;
  submitToolResults(results: readonly AxFunctionResult[]): Promise<void>;
  continue(): Promise<void>;
  steer(text: string): Promise<'native' | 'next-response'>;
  setThinkingTokenBudget(
    level: NonNullable<AxAIServiceOptions['thinkingTokenBudget']>
  ): Promise<'next-response'>;
  close(): void;
}
