import type { AxAgentCompletionProtocol } from '../../ai/types.js';
import type {
  AxAgentActorResultPayload,
  AxAgentClarification,
  AxAgentClarificationKind,
  AxAgentClarificationChoice,
  AxAgentStructuredClarification,
} from './AxAgent.js';

export type AxAgentGuidancePayload = {
  type: 'guide_agent';
  guidance: string;
  triggeredBy?: string;
};

export type AxAgentInternalCompletionPayload =
  | AxAgentActorResultPayload
  | AxAgentGuidancePayload;

export class AxAgentProtocolCompletionSignal extends Error {
  constructor(public readonly type: AxAgentInternalCompletionPayload['type']) {
    super(`AxAgent protocol completion: ${type}`);
    this.name = 'AxAgentProtocolCompletionSignal';
  }
}

export function createCompletionBindings(
  setCompletionPayload: (payload: AxAgentInternalCompletionPayload) => void
): {
  finalFunction: (...args: unknown[]) => void;
  askClarificationFunction: (...args: unknown[]) => void;
  protocol: AxAgentCompletionProtocol;
  protocolForTrigger: (triggeredBy?: string) => AxAgentCompletionProtocol;
} {
  const finalFunction = (...args: unknown[]) => {
    setCompletionPayload(normalizeCompletionPayload('final', args));
  };

  const askClarificationFunction = (...args: unknown[]) => {
    setCompletionPayload(normalizeCompletionPayload('askClarification', args));
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
  });

  return {
    finalFunction,
    askClarificationFunction,
    protocol: protocolForTrigger(),
    protocolForTrigger,
  };
}

export function normalizeCompletionPayload(
  type: AxAgentActorResultPayload['type'],
  args: unknown[]
): AxAgentActorResultPayload {
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
  if (rawChoices !== undefined) {
    if (!Array.isArray(rawChoices) || rawChoices.length === 0) {
      throw new Error(
        'askClarification() choices must be a non-empty array when provided'
      );
    }
  } else if (wantsChoices) {
    throw new Error(
      'askClarification() choice payloads require a non-empty choices array'
    );
  }

  return {
    ...payload,
    question: payload.question,
    ...(normalizedType ? { type: normalizedType } : {}),
    ...(rawChoices
      ? {
          choices: rawChoices.map(normalizeClarificationChoice),
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
