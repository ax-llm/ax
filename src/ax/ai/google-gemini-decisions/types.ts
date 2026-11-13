// cspell:ignore noul
export enum AxAIGoogleGeminiDecisionsModel {
  GeminiDecision1 = 'gemini-decision-1',
}

export type AxAIGoogleGeminiDecisionText = {
  readonly type: 'text';
  readonly text: string;
};
export type AxAIGoogleGeminiDecisionMedia = {
  readonly type: 'image' | 'audio' | 'video' | 'document';
  readonly mime_type: string;
  readonly resolution?: 'low' | 'medium' | 'high' | 'ultra_high';
} & (
  | { readonly data: string; readonly uri?: never }
  | { readonly uri: string; readonly data?: never }
);
export type AxAIGoogleGeminiDecisionContent =
  | AxAIGoogleGeminiDecisionText
  | AxAIGoogleGeminiDecisionMedia;
export type AxAIGoogleGeminiDecisionInstructions =
  | string
  | AxAIGoogleGeminiDecisionText
  | readonly AxAIGoogleGeminiDecisionText[];
export type AxAIGoogleGeminiDecisionQuestion = {
  readonly instructions: AxAIGoogleGeminiDecisionInstructions;
} & (
  | {
      readonly type: 'noul';
      readonly criteria?: {
        readonly true_description?: string;
        readonly false_description?: string;
      };
    }
  | {
      readonly type: 'choice';
      readonly criteria: Readonly<Record<string, string>>;
    }
  | {
      readonly type: 'score';
      /** Two to 255 nonempty descriptions, ordered from lowest to highest. */
      readonly criteria: readonly [string, string, ...string[]];
    }
);
export type AxAIGoogleGeminiDecisionsQuestions = Readonly<
  Record<string, AxAIGoogleGeminiDecisionQuestion>
>;
export type AxAIGoogleGeminiDecisionAnswer<
  Q extends AxAIGoogleGeminiDecisionQuestion,
> = Q extends { type: 'noul' }
  ? {
      readonly type: 'noul';
      readonly noul: number;
      readonly confidence: number;
    }
  : Q extends { type: 'choice'; criteria: infer C }
    ? {
        readonly type: 'choice';
        readonly choice: keyof C & string;
        readonly probabilities: { readonly [K in keyof C]: number };
        readonly confidence: number;
      }
    : Q extends { type: 'score' }
      ? {
          readonly type: 'score';
          readonly score: number;
          readonly probabilities: Readonly<Record<string, number>>;
          readonly legend: Readonly<Record<string, string>>;
          readonly confidence: number;
        }
      : never;
export type AxAIGoogleGeminiDecisionsRequest<
  Q extends
    AxAIGoogleGeminiDecisionsQuestions = AxAIGoogleGeminiDecisionsQuestions,
> = {
  readonly model?: string;
  readonly input:
    | string
    | AxAIGoogleGeminiDecisionContent
    | readonly AxAIGoogleGeminiDecisionContent[];
  readonly questions: Q;
};
export type AxAIGoogleGeminiDecisionsResponse<
  Q extends
    AxAIGoogleGeminiDecisionsQuestions = AxAIGoogleGeminiDecisionsQuestions,
> = {
  readonly answers: {
    readonly [K in keyof Q]: AxAIGoogleGeminiDecisionAnswer<Q[K]>;
  };
  readonly usage: {
    readonly total_input_tokens: number;
    readonly total_output_tokens: number;
    readonly total_tokens: number;
    readonly input_tokens_by_modality?: readonly {
      readonly modality: 'text' | 'image' | 'audio';
      readonly tokens: number;
    }[];
  };
};
