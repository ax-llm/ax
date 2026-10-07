export enum AxAIOpenAIDecisionsModel {
  GPT6Luna = 'gpt-6-luna',
}

/** Native OpenAI Decisions questions, evidence, and answers. */
export type AxAIOpenAIDecisionInputPart =
  | { readonly type: 'input_text'; readonly text: string }
  | {
      readonly type: 'input_image';
      readonly image_url: string;
      readonly detail?: 'low' | 'high' | 'auto' | 'original' | null;
    };
export type AxAIOpenAIDecisionInput =
  | string
  | readonly {
      readonly role: 'user';
      readonly type?: 'message';
      readonly content: string | readonly AxAIOpenAIDecisionInputPart[];
    }[];
export type AxAIOpenAIDecisionQuestion = {
  readonly name?: string;
  readonly instructions: string;
} & (
  | { readonly type: 'predicate' }
  | {
      readonly type: 'choice';
      readonly choices: readonly {
        readonly value: string | boolean;
        readonly description?: string;
      }[];
    }
  | {
      readonly type: 'score';
      readonly levels: readonly {
        readonly label: string;
        readonly description?: string;
      }[];
    }
);
export type AxAIOpenAIDecisionRefusal = {
  readonly type: 'refusal';
  readonly name: string | null;
};
export type AxAIOpenAIDecisionAnswer<
  Q extends AxAIOpenAIDecisionQuestion = AxAIOpenAIDecisionQuestion,
> =
  | AxAIOpenAIDecisionRefusal
  | ({ readonly name: string | null } & (Q extends { type: 'predicate' }
      ? { readonly type: 'predicate'; readonly probability: number }
      : Q extends { type: 'choice'; choices: readonly { value: infer V }[] }
        ? {
            readonly type: 'choice';
            readonly choice: V;
            readonly confidence: number;
            readonly probabilities: readonly {
              readonly value: V;
              readonly probability: number;
            }[];
          }
        : Q extends { type: 'score' }
          ? {
              readonly type: 'score';
              readonly score: number;
              readonly confidence: number;
              readonly probabilities: readonly {
                readonly value: number;
                readonly label: string;
                readonly probability: number;
              }[];
            }
          : never));
export type AxAIOpenAIDecisionsRequest<
  Q extends
    readonly AxAIOpenAIDecisionQuestion[] = readonly AxAIOpenAIDecisionQuestion[],
> = {
  readonly input: AxAIOpenAIDecisionInput;
  readonly questions: Q;
  readonly model?: string;
  readonly safety_identifier?: string | null;
};
export type AxAIOpenAIDecisionsResponse<
  Q extends
    readonly AxAIOpenAIDecisionQuestion[] = readonly AxAIOpenAIDecisionQuestion[],
> = {
  readonly model: string;
  /** Answers remain in request order, including refusals. */
  readonly answers: { readonly [K in keyof Q]: AxAIOpenAIDecisionAnswer<Q[K]> };
  readonly usage: {
    readonly input_tokens: number;
    readonly output_tokens: number;
    readonly total_tokens: number;
    readonly input_tokens_details: {
      readonly cached_tokens: number;
      readonly cache_write_tokens: number;
    };
    readonly output_tokens_details: { readonly reasoning_tokens: number };
  };
};
