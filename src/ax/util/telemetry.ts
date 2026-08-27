import type { Context, Span, SpanOptions, Tracer } from '@opentelemetry/api';
import { context } from '@opentelemetry/api';
import type { AxRuntimeHooks } from '../ai/types.js';

/**
 * Non-serializable runtime-hook state propagated through nested programs.
 * Symbols survive object spreads but are ignored by JSON, cache keys, and
 * exported program state.
 */
export const axRuntimeHookFrame = Symbol('ax.runtimeHookFrame');

export type AxRuntimeHookFrame = Readonly<{
  globals: AxRuntimeHooks;
  /** The option hook fields are fully resolved and may intentionally be empty. */
  resolved?: boolean;
}>;

export type AxRuntimeHookFramedOptions = Readonly<{
  [axRuntimeHookFrame]?: AxRuntimeHookFrame;
}>;

export function axGetRuntimeHookFrame(
  options: unknown
): AxRuntimeHookFrame | undefined {
  if (!options || typeof options !== 'object') return undefined;
  return (options as AxRuntimeHookFramedOptions)[axRuntimeHookFrame];
}

export function axFailOpenSpan(span: Span): Span {
  let ended = false;
  return new Proxy(span, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        try {
          if (property === 'end') {
            if (ended) return undefined;
            ended = true;
          }
          return Reflect.apply(value, target, args);
        } catch {
          return property === 'isRecording' ? false : undefined;
        }
      };
    },
  });
}

export function axStartSpanFailOpen(
  tracer: Tracer | undefined,
  name: string,
  options?: SpanOptions,
  parentContext?: Context
): Span | undefined {
  if (!tracer) return undefined;
  try {
    return axFailOpenSpan(tracer.startSpan(name, options, parentContext));
  } catch {
    return undefined;
  }
}

export async function axStartActiveSpanFailOpen<T>(
  tracer: Tracer | undefined,
  name: string,
  options: SpanOptions,
  parentContext: Context | undefined,
  operation: (span?: Span) => Promise<T>
): Promise<T> {
  if (!tracer) return operation();

  let invoked = false;
  let completed = false;
  let operationFailed = false;
  let result: T | undefined;
  let operationError: unknown;
  try {
    const traced = await tracer.startActiveSpan(
      name,
      options,
      parentContext ?? context.active(),
      async (span) => {
        invoked = true;
        try {
          result = await operation(axFailOpenSpan(span));
          completed = true;
          return result;
        } catch (error) {
          operationFailed = true;
          operationError = error;
          throw error;
        }
      }
    );
    return invoked ? traced : operation();
  } catch (error) {
    if (operationFailed) throw operationError;
    if (completed) return result as T;
    if (invoked) throw error;
    return operation();
  }
}
