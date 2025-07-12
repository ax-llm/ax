// ReadableStream is available globally in modern browsers and Node.js 16+

import type { AxChatResponse, AxModelUsage } from '../ai/types.js';
import { mergeFunctionCalls } from '../ai/util.js';
import type { AxAIMemory } from '../mem/types.js';

import {
  type AxAssertion,
  type AxStreamingAssertion,
  assertAssertions,
  assertStreamingAssertions,
} from './asserts.js';
import {
  extractValues,
  streamingExtractFinalValue,
  streamingExtractValues,
  streamValues,
} from './extract.js';
import {
  type AxFieldProcessor,
  processFieldProcessors,
  processStreamingFieldProcessors,
} from './fieldProcessor.js';
import { parseFunctionCalls, processFunctions } from './functions.js';
import type { AxResponseHandlerArgs, InternalAxGenState } from './generate.js';
import type { AsyncGenDeltaOut, DeltaOut } from './program.js';
import type { AxSignature } from './sig.js';
import type { AxGenOut } from './types.js';

type ProcessStreamingResponseArgs = Readonly<
  AxResponseHandlerArgs<ReadableStream<AxChatResponse>>
> & {
  states: InternalAxGenState[];
  usage: AxModelUsage[];
  asserts: AxAssertion[];
  streamingAsserts: AxStreamingAssertion[];
  fieldProcessors: AxFieldProcessor[];
  streamingFieldProcessors: AxFieldProcessor[];
  thoughtFieldName: string;
  signature: AxSignature;
  excludeContentFromTrace: boolean;
  functionResultFormatter?: (result: unknown) => string;
};

export async function* processStreamingResponse<OUT extends AxGenOut>({
  res,
  usage,
  states,
  ...args
}: ProcessStreamingResponseArgs): AsyncGenDeltaOut<OUT> {
  const skipEarlyFail =
    (args.ai.getFeatures().functionCot ?? false) &&
    args.functions !== undefined &&
    args.functions.length > 0;

  // Each streamed chunk contains a `modelUsage` object, with accumulated token usage data.
  // We'll only keep track of the latest modelUsage to push at the end.
  let lastChunkUsage: AxModelUsage | undefined;

  // Handle ReadableStream async iteration for browser compatibility
  const reader = res.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (lastChunkUsage) {
          usage.push(lastChunkUsage);
        }
        break;
      }
      const v = value;
      if (v.modelUsage) {
        lastChunkUsage = v.modelUsage;
      }

      for (const result of v.results) {
        if (
          (!result.content || result.content === '') &&
          (!result.thought || result.thought === '') &&
          (!result.functionCalls || result.functionCalls.length === 0)
        ) {
          continue;
        }

        const state = states.find((s) => s.index === result.index);
        if (!state) {
          throw new Error(`No state found for result (index: ${result.index})`);
        }

        yield* ProcessStreamingResponse<OUT>({
          ...args,
          result,
          skipEarlyFail,
          state,
        });
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Finalize the streams
  for (const state of states) {
    yield* finalizeStreamingResponse<OUT>({
      ...args,
      state,
    });
  }
}

type ProcessStreamingResponseArgs2 = Readonly<
  Omit<
    ProcessStreamingResponseArgs,
    | 'res'
    | 'states'
    | 'usage'
    | 'excludeContentFromTrace'
    | 'ai'
    | 'model'
    | 'traceId'
    | 'functions'
    | 'span'
    | 'fieldProcessors'
  > & {
    result: AxChatResponse['results'][number];
    skipEarlyFail: boolean;
    state: InternalAxGenState;
  }
>;

async function* ProcessStreamingResponse<OUT extends AxGenOut>({
  result,
  mem,
  sessionId,
  strictMode,
  skipEarlyFail,
  state,
  signature,
  streamingFieldProcessors,
  thoughtFieldName,
  streamingAsserts,
  asserts,
}: ProcessStreamingResponseArgs2): AsyncGenDeltaOut<OUT> {
  if (result.functionCalls && result.functionCalls.length > 0) {
    mergeFunctionCalls(state.functionCalls, result.functionCalls);
    mem.updateResult(
      {
        name: result.name,
        content: result.content,
        functionCalls: state.functionCalls,
        delta: result.functionCalls?.[0]?.function?.params as string,
        index: result.index,
      },
      sessionId
    );
  } else if (result.content && result.content.length > 0) {
    if (result.thought && result.thought.length > 0) {
      yield {
        index: result.index,
        delta: { [thoughtFieldName]: result.thought } as Partial<OUT>,
      };
    }

    state.content += result.content;
    mem.updateResult(
      {
        name: result.name,
        content: state.content,
        delta: result.content,
        index: result.index,
      },
      sessionId
    );

    const skip = streamingExtractValues(
      signature,
      state.values,
      state.xstate,
      state.content,
      { strictMode, skipEarlyFail }
    );

    if (skip) {
      return;
    }

    if (streamingAsserts.length !== 0) {
      await assertStreamingAssertions(
        streamingAsserts,
        state.xstate,
        state.content
      );
    }

    if (streamingFieldProcessors.length !== 0) {
      await processStreamingFieldProcessors(
        streamingFieldProcessors,
        state.content,
        state.xstate,
        mem,
        state.values,
        sessionId
      );
    }

    yield* streamValues<OUT>(
      signature,
      state.content,
      state.values as Record<string, OUT>,
      state.xstate,
      result.index
    );

    await assertAssertions(asserts, state.values);
  } else if (result.thought && result.thought.length > 0) {
    state.values[thoughtFieldName] =
      (state.values[thoughtFieldName] ?? '') + result.thought;

    yield {
      index: result.index,
      delta: { [thoughtFieldName]: result.thought } as Partial<OUT>,
    };
  }

  if (result.finishReason === 'length') {
    throw new Error(
      `Max tokens reached before completion\nContent: ${state.content}`
    );
  }
}

type FinalizeStreamingResponseArgs = Readonly<
  Omit<ProcessStreamingResponseArgs, 'res' | 'states' | 'usage'> & {
    state: InternalAxGenState;
  }
>;

export async function* finalizeStreamingResponse<OUT extends AxGenOut>({
  state,
  signature,
  ai,
  model,
  functions,
  mem,
  sessionId,
  traceId,
  span,
  excludeContentFromTrace,
  streamingAsserts,
  asserts,
  fieldProcessors,
  streamingFieldProcessors,
  functionResultFormatter,
}: FinalizeStreamingResponseArgs) {
  const funcs = parseFunctionCalls(
    ai,
    state.functionCalls,
    state.values,
    model
  );
  if (funcs) {
    if (!functions) {
      throw new Error('Functions are not defined');
    }
    const fx = await processFunctions({
      ai,
      functionList: functions,
      functionCalls: funcs,
      mem,
      sessionId,
      traceId,
      span,
      index: state.index,
      excludeContentFromTrace,
      functionResultFormatter,
    });
    state.functionsExecuted = new Set([...state.functionsExecuted, ...fx]);
  } else {
    streamingExtractFinalValue(
      signature,
      state.values,
      state.xstate,
      state.content
    );

    await assertStreamingAssertions(
      streamingAsserts,
      state.xstate,
      state.content,
      true
    );
    await assertAssertions(asserts, state.values);

    if (fieldProcessors.length) {
      await processFieldProcessors(
        fieldProcessors,
        state.values,
        mem,
        sessionId
      );
    }

    if (streamingFieldProcessors.length !== 0) {
      await processStreamingFieldProcessors(
        streamingFieldProcessors,
        state.content,
        state.xstate,
        mem,
        state.values,
        sessionId,
        true
      );
    }

    yield* streamValues<OUT>(
      signature,
      state.content,
      state.values as Record<string, OUT>,
      state.xstate,
      state.index
    );
  }
}

export async function* processResponse<OUT extends AxGenOut>({
  ai,
  res,
  mem,
  sessionId,
  traceId,
  functions,
  span,
  strictMode,
  states,
  usage,
  excludeContentFromTrace,
  asserts,
  fieldProcessors,
  thoughtFieldName,
  signature,
  functionResultFormatter,
}: Readonly<AxResponseHandlerArgs<AxChatResponse>> & {
  states: InternalAxGenState[];
  usage: AxModelUsage[];
  excludeContentFromTrace: boolean;
  asserts: AxAssertion[];
  fieldProcessors: AxFieldProcessor[];
  thoughtFieldName: string;
  signature: AxSignature;
  functionResultFormatter?: (result: unknown) => string;
}): AsyncGenDeltaOut<OUT> {
  const results = res.results ?? [];

  mem.addResponse(results, sessionId);

  for (const result of results) {
    const state = states[result.index];

    if (!state) {
      throw new Error(`No state found for result (index: ${result.index})`);
    }

    if (res.modelUsage) {
      usage.push(res.modelUsage);
    }

    if (result.functionCalls?.length) {
      const funcs = parseFunctionCalls(ai, result.functionCalls, state.values);
      if (funcs) {
        if (!functions) {
          throw new Error('Functions are not defined');
        }

        const fx = await processFunctions({
          ai,
          functionList: functions,
          functionCalls: funcs,
          mem,
          sessionId,
          traceId,
          span,
          excludeContentFromTrace,
          index: result.index,
          functionResultFormatter,
        });

        state.functionsExecuted = new Set([...state.functionsExecuted, ...fx]);
      }
    } else if (result.content) {
      if (result.thought && result.thought.length > 0) {
        state.values[thoughtFieldName] = result.thought;
      }

      extractValues(signature, state.values, result.content, strictMode);
      await assertAssertions(asserts, state.values);

      if (fieldProcessors.length) {
        await processFieldProcessors(
          fieldProcessors,
          state.values,
          mem,
          sessionId
        );
      }
    }

    if (result.finishReason === 'length') {
      throw new Error(
        `Max tokens reached before completion\nContent: ${result.content}`
      );
    }
  }

  const values = states.map((s) => s.values);

  // Strip out values whose signature fields have isInternal: true
  for (const v of values) {
    for (const field of signature.getOutputFields()) {
      if (field.isInternal) {
        delete v[field.name];
      }
    }
  }

  const outputFields = signature.getOutputFields();
  const deltas: DeltaOut<OUT>[] = values.map((v, index) => {
    const delta: Record<string, unknown> = {};
    for (const field of outputFields) {
      if (field.isInternal) {
        continue;
      }
      delta[field.name] = v[field.name];
    }
    // Include thought field if it exists in the values
    if (v[thoughtFieldName] !== undefined) {
      delta[thoughtFieldName] = v[thoughtFieldName];
    }
    return { index, delta: delta as Partial<OUT> };
  });

  for (const delta of deltas) {
    yield delta;
  }
}

export function shouldContinueSteps(
  mem: AxAIMemory,
  stopFunction: string | undefined,
  states: InternalAxGenState[],
  sessionId?: string
) {
  const lastMemItem = mem.getLast(sessionId);

  if (!lastMemItem) {
    return true;
  }

  for (const [index, state] of states.entries()) {
    const stopFunctionExecuted =
      stopFunction && state.functionsExecuted.has(stopFunction);

    const chat = lastMemItem.chat[index];

    if (!chat) {
      throw new Error(`No chat message found for result (index: ${index})`);
    }

    const isFunction = lastMemItem.role === 'function';
    const isProcessor = lastMemItem.tags
      ? lastMemItem.tags.some((tag) => tag === 'processor')
      : false;

    // If any state has stop function executed, return false immediately
    if (isFunction && stopFunction && stopFunctionExecuted) {
      return false;
    }

    // If this state doesn't meet continuation criteria, return false
    if (!(isFunction || isProcessor)) {
      return false;
    }
  }

  // All states meet continuation criteria
  return true;
}
