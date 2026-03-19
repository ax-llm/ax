import type { AxAgentCompletionProtocol } from '../../ai/types.js';
import type {
  AxAgentActorResultPayload,
  AxAgentClarification,
  AxAgentClarificationKind,
  AxAgentClarificationChoice,
  AxAgentStructuredClarification,
} from './AxAgent.js';

export class AxAgentProtocolCompletionSignal extends Error {
  constructor(public readonly type: AxAgentActorResultPayload['type']) {
    super(`AxAgent protocol completion: ${type}`);
    this.name = 'AxAgentProtocolCompletionSignal';
  }
}

export function createCompletionBindings(
  setActorResultPayload: (
    type: AxAgentActorResultPayload['type'],
    args: unknown[]
  ) => void
): {
  finalFunction: (...args: unknown[]) => void;
  askClarificationFunction: (...args: unknown[]) => void;
  protocol: AxAgentCompletionProtocol;
} {
  const finalFunction = (...args: unknown[]) => {
    setActorResultPayload('final', args);
  };

  const askClarificationFunction = (...args: unknown[]) => {
    setActorResultPayload('ask_clarification', args);
  };

  const protocol: AxAgentCompletionProtocol = {
    final: (...args: unknown[]): never => {
      setActorResultPayload('final', args);
      throw new AxAgentProtocolCompletionSignal('final');
    },
    askClarification: (...args: unknown[]): never => {
      setActorResultPayload('ask_clarification', args);
      throw new AxAgentProtocolCompletionSignal('ask_clarification');
    },
  };

  return {
    finalFunction,
    askClarificationFunction,
    protocol,
  };
}

export function normalizeCompletionPayload(
  type: AxAgentActorResultPayload['type'],
  args: unknown[]
): AxAgentActorResultPayload {
  if (args.length === 0) {
    throw new Error(`${type}() requires at least one argument`);
  }

  if (type === 'ask_clarification') {
    if (args.length !== 1) {
      throw new Error('ask_clarification() requires exactly one argument');
    }

    return {
      type,
      args: [normalizeClarificationPayload(args[0])],
    };
  }

  return { type, args };
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
      'ask_clarification() choice entries must be non-empty strings or objects with a non-empty label'
    );
  }

  if (!isNonEmptyString(choice.label)) {
    throw new Error(
      'ask_clarification() choice objects require a non-empty label'
    );
  }

  if (choice.value !== undefined && !isNonEmptyString(choice.value)) {
    throw new Error(
      'ask_clarification() choice object values must be non-empty strings'
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
      'ask_clarification() requires a non-empty string or an object payload'
    );
  }

  if (!isNonEmptyString(payload.question)) {
    throw new Error(
      'ask_clarification() object payload requires a non-empty question'
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
        'ask_clarification() object payload type must be one of: text, number, date, single_choice, multiple_choice'
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
        'ask_clarification() choices must be a non-empty array when provided'
      );
    }
  } else if (wantsChoices) {
    throw new Error(
      'ask_clarification() choice payloads require a non-empty choices array'
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
