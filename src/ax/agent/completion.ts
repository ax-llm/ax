import type { AxAgentCompletionProtocol } from '../ai/types.js';
import type {
  AxAgentClarification,
  AxAgentClarificationChoice,
  AxAgentClarificationKind,
  AxAgentExecutorResultPayload,
  AxAgentStructuredClarification,
} from './AxAgent.js';

export type AxAgentGuidancePayload = {
  type: 'guide_agent';
  guidance: string;
  triggeredBy?: string;
};

export type AxAgentInternalCompletionPayload =
  | AxAgentExecutorResultPayload
  | AxAgentGuidancePayload;

export class AxAgentProtocolCompletionSignal extends Error {
  constructor(public readonly type: AxAgentInternalCompletionPayload['type']) {
    super(`AxAgent protocol completion: ${type}`);
    this.name = 'AxAgentProtocolCompletionSignal';
  }
}

export function createCompletionBindings(
  setCompletionPayload: (payload: AxAgentInternalCompletionPayload) => void,
  agentStatusCallback?: (
    message: string,
    status: 'success' | 'failed'
  ) => void | Promise<void>
): {
  finalFunction: (...args: unknown[]) => never;
  askClarificationFunction: (...args: unknown[]) => never;
  protocol: AxAgentCompletionProtocol;
  protocolForTrigger: (triggeredBy?: string) => AxAgentCompletionProtocol;
} {
  const FINAL_USAGE =
    'Usage: final(message: string) or final(outputGenerationTask: string, context: object).';

  const ASK_CLARIFICATION_USAGE =
    'Usage: askClarification(question: string) or askClarification({ question: string, type?: "text" | "date" | "number" | "single_choice" | "multiple_choice", choices?: string[] })';

  const finalFunction = (...args: unknown[]): never => {
    // final() — no args
    if (args.length === 0) {
      throw new Error(`final() requires at least one argument. ${FINAL_USAGE}`);
    }

    // First arg must always be a non-empty string
    if (typeof args[0] !== 'string' || args[0].trim().length === 0) {
      throw new Error(
        `final() first argument must be a non-empty string. ${FINAL_USAGE}`
      );
    }

    // final(message: string) → responder flow without extra context
    if (args.length === 1) {
      setCompletionPayload(normalizeCompletionPayload('final', args));
      throw new AxAgentProtocolCompletionSignal('final');
    }

    // final(task: string, context: object) → responder flow
    if (args.length === 2) {
      if (
        args[1] === null ||
        typeof args[1] !== 'object' ||
        Array.isArray(args[1])
      ) {
        throw new Error(
          `final() second argument must be a context object. ${FINAL_USAGE}`
        );
      }
      setCompletionPayload(normalizeCompletionPayload('final', args));
      throw new AxAgentProtocolCompletionSignal('final');
    }

    // Too many args
    throw new Error(
      `final() accepts at most 2 arguments, got ${args.length}. ${FINAL_USAGE}`
    );
  };

  const askClarificationFunction = (...args: unknown[]): never => {
    if (args.length === 0) {
      throw new Error(
        `askClarification() requires exactly one argument. ${ASK_CLARIFICATION_USAGE}`
      );
    }
    if (args.length > 1) {
      throw new Error(
        `askClarification() requires exactly one argument, got ${args.length}. ${ASK_CLARIFICATION_USAGE}`
      );
    }
    setCompletionPayload(normalizeCompletionPayload('askClarification', args));
    throw new AxAgentProtocolCompletionSignal('askClarification');
  };

  const successFn = async (message: string): Promise<void> => {
    await agentStatusCallback?.(message, 'success');
  };

  const failedFn = async (message: string): Promise<void> => {
    await agentStatusCallback?.(message, 'failed');
  };

  const protocolForTrigger = (
    triggeredBy?: string
  ): AxAgentCompletionProtocol => ({
    final: (...args: unknown[]): never => {
      setCompletionPayload(normalizeCompletionPayload('final', args));
      throw new AxAgentProtocolCompletionSignal('final');
    },
    askClarification: (...args: unknown[]): never => {
      setCompletionPayload(
        normalizeCompletionPayload('askClarification', args)
      );
      throw new AxAgentProtocolCompletionSignal('askClarification');
    },
    guideAgent: (...args: unknown[]): never => {
      setCompletionPayload(normalizeGuidancePayload(args, triggeredBy));
      throw new AxAgentProtocolCompletionSignal('guide_agent');
    },
    success: successFn,
    failed: failedFn,
  });

  return {
    finalFunction,
    askClarificationFunction,
    protocol: protocolForTrigger(),
    protocolForTrigger,
  };
}

export function normalizeCompletionPayload(
  type: AxAgentExecutorResultPayload['type'],
  args: unknown[]
): AxAgentExecutorResultPayload {
  if (args.length === 0) {
    throw new Error(`${type}() requires at least one argument`);
  }

  if (type === 'askClarification') {
    if (args.length !== 1) {
      throw new Error('askClarification() requires exactly one argument');
    }

    return {
      type,
      args: [normalizeClarificationPayload(args[0])],
    };
  }

  return { type, args };
}

export function normalizeGuidancePayload(
  args: readonly unknown[],
  triggeredBy?: string
): AxAgentGuidancePayload {
  if (args.length !== 1) {
    throw new Error('guideAgent() requires exactly one argument');
  }

  if (!isNonEmptyString(args[0])) {
    throw new Error('guideAgent() requires a non-empty string guidance');
  }

  return {
    type: 'guide_agent',
    guidance: args[0],
    ...(triggeredBy ? { triggeredBy } : {}),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeClarificationChoice(
  choice: unknown
): AxAgentClarificationChoice {
  if (isNonEmptyString(choice)) {
    return choice;
  }

  if (!isPlainObject(choice)) {
    throw new Error(
      'askClarification() choice entries must be non-empty strings or objects with a non-empty label'
    );
  }

  if (!isNonEmptyString(choice.label)) {
    throw new Error(
      'askClarification() choice objects require a non-empty label'
    );
  }

  if (choice.value !== undefined && !isNonEmptyString(choice.value)) {
    throw new Error(
      'askClarification() choice object values must be non-empty strings'
    );
  }

  return {
    label: choice.label,
    ...(choice.value !== undefined ? { value: choice.value } : {}),
  };
}

function createMultipleChoiceClarificationError(detail?: string): Error {
  const suffix = detail ? ` ${detail}` : '';
  return new Error(
    'askClarification() with type "multiple_choice" must include at least two valid choices. Use a non-empty string question plus choices like ["Option A", "Option B"], or switch to "single_choice" / a plain question if there is only one option.' +
      suffix
  );
}

function stripChoiceMetadata(
  payload: Record<string, unknown>,
  options?: Readonly<{ dropType?: boolean }>
): AxAgentStructuredClarification {
  const { choices: _choices, ...restWithType } = payload;

  if (options?.dropType) {
    const { type: _type, ...rest } = restWithType;
    return {
      ...rest,
      question: payload.question as string,
    };
  }

  return {
    ...restWithType,
    question: payload.question as string,
  };
}

function normalizeClarificationPayload(payload: unknown): AxAgentClarification {
  if (isNonEmptyString(payload)) {
    return payload;
  }

  if (!isPlainObject(payload)) {
    throw new Error(
      'askClarification() requires a non-empty string or an object payload'
    );
  }

  if (!isNonEmptyString(payload.question)) {
    throw new Error(
      'askClarification() object payload requires a non-empty question'
    );
  }

  const allowedTypes = new Set<AxAgentClarificationKind>([
    'text',
    'number',
    'date',
    'single_choice',
    'multiple_choice',
  ]);

  let normalizedType: AxAgentClarificationKind | undefined;
  if (payload.type === undefined) {
    normalizedType =
      Array.isArray(payload.choices) && payload.choices.length > 0
        ? 'single_choice'
        : undefined;
  } else {
    if (
      typeof payload.type !== 'string' ||
      !allowedTypes.has(payload.type as AxAgentClarificationKind)
    ) {
      throw new Error(
        'askClarification() object payload type must be one of: text, number, date, single_choice, multiple_choice'
      );
    }
    normalizedType = payload.type as AxAgentClarificationKind;
  }

  const wantsChoices =
    normalizedType === 'single_choice' || normalizedType === 'multiple_choice';
  const rawChoices = payload.choices;
  let normalizedChoices: AxAgentClarificationChoice[] | undefined;

  if (rawChoices !== undefined) {
    if (!Array.isArray(rawChoices) || rawChoices.length === 0) {
      if (normalizedType === 'multiple_choice') {
        throw createMultipleChoiceClarificationError();
      }

      return stripChoiceMetadata(payload, {
        dropType: normalizedType === 'single_choice',
      });
    }

    try {
      normalizedChoices = rawChoices.map(normalizeClarificationChoice);
    } catch (error) {
      if (normalizedType === 'multiple_choice') {
        const detail =
          error instanceof Error
            ? `Fix the choices so each option is a non-empty string or an object with a non-empty label. ${error.message}`
            : undefined;
        throw createMultipleChoiceClarificationError(detail);
      }

      return stripChoiceMetadata(payload, {
        dropType: normalizedType === 'single_choice',
      });
    }
  } else if (wantsChoices) {
    if (normalizedType === 'multiple_choice') {
      throw createMultipleChoiceClarificationError();
    }

    return stripChoiceMetadata(payload, { dropType: true });
  }

  if (normalizedType === 'multiple_choice') {
    if (!normalizedChoices || normalizedChoices.length < 2) {
      throw createMultipleChoiceClarificationError();
    }
  }

  return {
    ...payload,
    question: payload.question,
    ...(normalizedType ? { type: normalizedType } : {}),
    ...(normalizedChoices
      ? {
          choices: normalizedChoices,
        }
      : {}),
  };
}

export function normalizeClarificationForError(
  clarification: AxAgentClarification
): AxAgentStructuredClarification {
  const normalized = normalizeClarificationPayload(clarification);
  return typeof normalized === 'string' ? { question: normalized } : normalized;
}
