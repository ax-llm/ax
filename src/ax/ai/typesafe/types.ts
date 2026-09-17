// cspell:ignore noul jev systemone
/** JSON values accepted in native Typesafe state and criteria. */
export type AxAITypesafeJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly AxAITypesafeJsonValue[]
  | { readonly [key: string]: AxAITypesafeJsonValue };

/** Native state, instructions, or a criterion description. */
export type AxAITypesafeEntry =
  | string
  | null
  | readonly AxAITypesafeJsonValue[]
  | { readonly [key: string]: AxAITypesafeJsonValue };

export type AxAITypesafeNoulQuestion = {
  readonly type: 'noul';
  readonly instructions?: AxAITypesafeEntry;
  readonly criteria?: {
    readonly true?: AxAITypesafeEntry;
    readonly false?: AxAITypesafeEntry;
  } | null;
};

export type AxAITypesafeChoiceQuestion = {
  readonly type: 'choice';
  readonly instructions?: AxAITypesafeEntry;
  readonly criteria: Readonly<Record<string, AxAITypesafeEntry>>;
};

export type AxAITypesafeScoreQuestion = {
  readonly type: 'score';
  readonly instructions?: AxAITypesafeEntry;
  /** Two to ten descriptions, ordered from lowest to highest. */
  readonly criteria: readonly [
    AxAITypesafeEntry,
    AxAITypesafeEntry,
    ...AxAITypesafeEntry[],
  ];
};

export type AxAITypesafeQuestion =
  | AxAITypesafeNoulQuestion
  | AxAITypesafeChoiceQuestion
  | AxAITypesafeScoreQuestion;

export type AxAITypesafeQuestions = Readonly<
  Record<string, AxAITypesafeQuestion>
>;

export type AxAITypesafeAnswer<Q extends AxAITypesafeQuestion> =
  Q extends AxAITypesafeNoulQuestion
    ? { readonly type: 'noul'; readonly noul: number }
    : Q extends AxAITypesafeChoiceQuestion
      ? {
          readonly type: 'choice';
          readonly choice: keyof Q['criteria'] & string;
          readonly probabilities: {
            readonly [K in keyof Q['criteria']]: number;
          };
          readonly confidence: number;
        }
      : Q extends AxAITypesafeScoreQuestion
        ? {
            readonly type: 'score';
            /** Fractional expected rubric index, starting at zero. */
            readonly score: number;
            readonly probabilities: Readonly<Record<string, number>>;
            readonly legend: Readonly<Record<string, AxAITypesafeEntry>>;
            readonly confidence: number;
          }
        : never;

export type AxAITypesafeRequest<
  Q extends AxAITypesafeQuestions = AxAITypesafeQuestions,
> = {
  readonly state: AxAITypesafeEntry;
  readonly questions: Q;
  readonly model?: string;
};

export type AxAITypesafeResponse<
  Q extends AxAITypesafeQuestions = AxAITypesafeQuestions,
> = {
  readonly model: string;
  readonly answers: { readonly [K in keyof Q]: AxAITypesafeAnswer<Q[K]> };
  readonly usage: {
    readonly input_tokens: number;
    readonly output_tokens: number;
  };
};

export type AxAITypesafeModelCard = {
  readonly name: string;
  readonly description: string;
  readonly release_date: string;
};
