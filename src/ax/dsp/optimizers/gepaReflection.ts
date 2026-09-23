import type { AxAIService, AxAIServiceOptions } from '../../ai/types.js';
import type { AxExample } from '../common_types.js';
import { ax } from '../template.js';
import type { AxGEPAComponentTarget } from './gepaComponents.js';

export type AxGEPAReflectiveTuple = {
  input: AxExample;
  prediction: unknown;
  score: number;
};

export type AxGEPATraceSummaryCall = {
  componentId?: string;
  fn: string;
  ok: boolean;
  ms: number;
  args: string;
  result: string;
};

export type AxGEPATraceSummary = {
  score: number;
  calls: AxGEPATraceSummaryCall[];
  output?: string;
  error?: string;
};

export function renderReflectiveValue(value: unknown, maxChars = 800): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length <= maxChars
      ? trimmed
      : `${trimmed.slice(0, Math.max(0, maxChars - 3))}...`;
  }

  try {
    const rendered = JSON.stringify(value, null, 2).trim();
    return rendered.length <= maxChars
      ? rendered
      : `${rendered.slice(0, Math.max(0, maxChars - 3))}...`;
  } catch {
    const fallback = String(value).trim();
    return fallback.length <= maxChars
      ? fallback
      : `${fallback.slice(0, Math.max(0, maxChars - 3))}...`;
  }
}

export function summarizeGEPATraces(
  traceDataset: readonly unknown[] | undefined,
  options?: Readonly<{ maxRows?: number; maxValueChars?: number }>
): AxGEPATraceSummary[] | undefined {
  if (!traceDataset || traceDataset.length === 0) return undefined;
  const maxRows = Math.max(1, options?.maxRows ?? 8);
  const maxValueChars = Math.max(40, options?.maxValueChars ?? 240);

  return traceDataset.slice(0, maxRows).map((item: any) => ({
    score: Number(item?.score ?? 0),
    calls: Array.isArray(item?.calls)
      ? item.calls.map((call: any) => ({
          componentId:
            typeof call?.componentId === 'string'
              ? call.componentId
              : undefined,
          fn: String(call?.fn ?? ''),
          ok: Boolean(call?.ok),
          ms: Number(call?.ms ?? 0),
          args: renderReflectiveValue(call?.args, maxValueChars),
          result: renderReflectiveValue(call?.result, maxValueChars),
        }))
      : [],
    output:
      item?.output === undefined
        ? undefined
        : renderReflectiveValue(item.output, maxValueChars),
    error:
      item?.error === undefined
        ? undefined
        : renderReflectiveValue(item.error, maxValueChars),
  }));
}

/**
 * Asks the teacher for a new component value, retrying up to `maxAttempts`
 * times. Returns undefined when no attempt produced a valid value, and
 * rethrows the error when the last attempt's teacher call failed.
 */
export async function proposeGEPAComponentValue(args: {
  ai: AxAIService;
  options?: Readonly<AxAIServiceOptions>;
  target: Readonly<AxGEPAComponentTarget>;
  currentValue: string;
  tuples: readonly AxGEPAReflectiveTuple[];
  feedbackSummary?: string;
  traceDataset?: readonly unknown[];
  maxAttempts?: number;
}): Promise<string | undefined> {
  // currentValue is optional because components can start empty (an ax()
  // program's instruction does), and a required input rejects ''.
  const refl = ax(
    `componentKey:string "Component key", componentKind:string "Free-form component kind hint", componentDescription?:string "What this string is used for", constraints?:string "Hard constraints on the new value", currentValue?:string "Current value of the component", feedbackSummary?:string "Summarized feedback", previousValidationError?:string "Why the previous proposal was rejected; avoid repeating it", minibatch:json "Array of {input,prediction,score}", traceDataset?:json "Compact actionable execution trace summaries relevant to this component" -> newValue:string "Improved value for the component"`
  );

  const attempts = Math.max(1, args.maxAttempts ?? 2);
  let previousValidationError: string | undefined;
  const traceDataset = summarizeGEPATraces(args.traceDataset);
  const minibatch =
    args.tuples.length > 0
      ? args.tuples
      : [{ input: {}, prediction: {}, score: 0 }];
  const metadataConstraints = [
    args.target.constraints,
    args.target.format ? `Format: ${args.target.format}.` : undefined,
    typeof args.target.maxLength === 'number'
      ? `Maximum length: ${args.target.maxLength} characters.`
      : undefined,
    args.target.preserve && args.target.preserve.length > 0
      ? `Preserve these literals exactly: ${args.target.preserve.join(', ')}.`
      : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n');
  let lastError: { error: unknown } | undefined;
  for (let attempt = 0; attempt < attempts; attempt++) {
    lastError = undefined;
    try {
      const out = (await refl.forward(
        args.ai,
        {
          componentKey: args.target.id,
          componentKind: args.target.kind,
          componentDescription: args.target.description,
          constraints: metadataConstraints || undefined,
          currentValue: args.currentValue,
          feedbackSummary: args.feedbackSummary,
          previousValidationError,
          minibatch,
          traceDataset,
        } as any,
        args.options
      )) as any;
      const candidate = (out?.newValue as string | undefined)?.trim();
      if (!candidate) continue;
      const validation = args.target.validate?.(candidate) ?? true;
      if (validation === true) return candidate;
      previousValidationError = validation;
    } catch (error) {
      lastError = { error };
    }
  }
  if (lastError) throw lastError.error;
  return undefined;
}
