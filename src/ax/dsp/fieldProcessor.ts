import type { AxAIMemory } from '../mem/types.js';

import type { extractionState } from './extract.js';
import type { AxField } from './sig.js';
import type { AxFieldValue, AxGenOut } from './types.js';

export type AxFieldProcessorProcess = (
  value: AxFieldValue,
  context?: Readonly<{
    values?: AxGenOut;
    sessionId?: string;
    done?: boolean;
  }>
) => unknown | Promise<unknown>;

export type AxStreamingFieldProcessorProcess = (
  value: string,
  context?: Readonly<{
    values?: AxGenOut;
    sessionId?: string;
    done?: boolean;
  }>
) => unknown | Promise<unknown>;
export interface AxFieldProcessor {
  field: Readonly<AxField>;

  /**
   * Process the field value and return a new value (or undefined if no update is needed).
   * The returned value may be merged back into memory.
   * @param value - The current field value.
   * @param context - Additional context (e.g. memory and session id).
   */
  process: AxFieldProcessorProcess | AxStreamingFieldProcessorProcess;
}

/**
 * For synchronous responses: iterates over registered field processors,
 * passing in the current values. If a processor returns a new value,
 * that value is merged into memory with a special role ('processor').
 */
export async function processFieldProcessors(
  fieldProcessors: AxFieldProcessor[],
  values: AxGenOut,
  mem: AxAIMemory,
  sessionId?: string
) {
  for (const processor of fieldProcessors) {
    if (values[processor.field.name] === undefined) {
      continue;
    }

    const processFn = processor.process as AxFieldProcessorProcess;
    const result = await processFn(values[processor.field.name], {
      sessionId,
      values,
      done: true,
    });
    addToMemory(processor.field, mem, result, sessionId);
  }
}

/**
 * For streaming responses: processes each streaming field processor
 * and yields delta updates if they return new values.
 */
export async function processStreamingFieldProcessors(
  fieldProcessors: AxFieldProcessor[],
  content: string,
  xstate: Readonly<extractionState>,
  mem: AxAIMemory,
  values: AxGenOut,
  sessionId: string | undefined,
  done = false,
  // Mid-stream results wait here until the step ends; see
  // addPendingFeedbackToMemory.
  pendingFeedback?: unknown[]
): Promise<void> {
  for (const processor of fieldProcessors) {
    if (xstate.currField?.name !== processor.field.name) {
      continue;
    }

    let value = content.substring(xstate.s);

    if (xstate.currField?.type?.name === 'code') {
      // remove markdown block
      value = value.replace(/^[ ]*```[a-zA-Z0-9]*\n\s*/, '');
      value = value.replace(/\s*```\s*$/, '');
    }
    const processFn = processor.process as AxStreamingFieldProcessorProcess;
    const result = await processFn(value, {
      sessionId,
      values,
      done,
    });

    if (pendingFeedback) {
      pendingFeedback.push(result);
    } else {
      addToMemory(xstate.currField, mem, result, sessionId);
    }
  }
}

/**
 * Adds the feedback streaming field processors returned mid-stream, after
 * the step's full assistant message, so the run takes another step with it.
 */
export function addPendingFeedbackToMemory(
  pendingFeedback: unknown[] | undefined,
  mem: AxAIMemory,
  sessionId: string | undefined
): void {
  for (const result of pendingFeedback?.splice(0) ?? []) {
    addFeedbackToMemory(mem, result, sessionId);
  }
}

const addToMemory = (
  _field: Readonly<AxField>,
  mem: AxAIMemory,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any | any[],
  sessionId?: string
) => addFeedbackToMemory(mem, result, sessionId);

// A processor result becomes a user message tagged `processor`. undefined,
// null, '' and the text "null" or "undefined" are no feedback.
const addFeedbackToMemory = (
  mem: AxAIMemory,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any | any[],
  sessionId?: string
) => {
  if (
    result === undefined ||
    result === null ||
    (typeof result === 'string' &&
      (result === '' || /^(null|undefined)\s*$/i.test(result)))
  ) {
    return;
  }

  const resultText = String(result);

  const text = getFieldProcessingMessage(resultText);
  mem.addRequest(
    [{ role: 'user', content: [{ type: 'text', text }] }],
    sessionId
  );
  mem.addTag('processor', sessionId);
};

function getFieldProcessingMessage(resultText: string) {
  return resultText;
}
