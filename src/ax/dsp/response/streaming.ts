import type { AxChatResponse, AxModelUsage } from '../../ai/types.js';
import { mergeFunctionCalls } from '../../ai/util.js';
import { ValidationError } from '../errors.js';
import { streamingExtractValues, streamValues } from '../extract.js';
import { processStreamingFieldProcessors } from '../fieldProcessor.js';
import { checkStreamingGuards } from '../guards.js';
import type { AsyncGenDeltaOut, AxGenOut } from '../types.js';
import { finalizeStreamingResponse } from './finalize.js';
import {
  createStructuredDelta,
  getOrCreateStructuredAccumulator,
  parseStructuredPartial,
  prepareStructuredPartialValues,
  validateStructuredPartialValues,
} from './structuredDelta.js';
import type {
  InternalAxGenState,
  ProcessStreamingResponseArgs,
} from './types.js';
import { collectResultCitations, pushAndLogUsage } from './usage.js';

export async function* processStreamingResponse<OUT extends AxGenOut>({
  res,
  usage,
  states,
  debug,
  stepContext,
  ...args
}: ProcessStreamingResponseArgs): AsyncGenDeltaOut<OUT> {
  const skipEarlyFail =
    (args.ai.getFeatures().functionCot ?? false) &&
    args.functions !== undefined &&
    args.functions.length > 0;

  let lastChunkUsage: AxModelUsage | undefined;
  const aggregatedCitations: NonNullable<AxModelUsage['citations']> = [];

  const reader = res.getReader();
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        completed = true;
        break;
      }
      const v = value;
      if (v.modelUsage) {
        lastChunkUsage = v.modelUsage;
      }

      aggregatedCitations.push(...collectResultCitations(v.results));

      for (const result of v.results) {
        if (
          (!result.content || result.content === '') &&
          (!result.thought || result.thought === '') &&
          (!result.thoughtBlocks || result.thoughtBlocks.length === 0) &&
          (!result.functionCalls || result.functionCalls.length === 0)
        ) {
          continue;
        }

        const state = states[result.index];
        if (!state) {
          throw new Error(`No state found for result (index: ${result.index})`);
        }

        yield* processStreamingResult<OUT>({
          ...args,
          result,
          skipEarlyFail,
          state,
          debug,
        });
      }
    }
  } catch (error) {
    if (!completed) {
      try {
        await reader.cancel(error);
      } catch {}
    }
    throw error;
  } finally {
    reader.releaseLock();
  }

  for (const state of states) {
    yield* finalizeStreamingResponse<OUT>({
      ...args,
      state,
      debug,
      stepContext,
    });
  }

  pushAndLogUsage({
    ai: args.ai,
    usage,
    modelUsage: lastChunkUsage,
    citations: aggregatedCitations,
    debug,
    logger: args.logger,
    debugPromptMetrics: args.debugPromptMetrics,
  });
}

type ProcessStreamingResultArgs = Readonly<
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
    treatAllFieldsOptional?: boolean;
  }
>;

async function* processStreamingResult<OUT extends AxGenOut>({
  result,
  mem,
  sessionId,
  strictMode,
  skipEarlyFail,
  treatAllFieldsOptional,
  state,
  signature,
  streamingFieldProcessors,
  thoughtFieldName,
  streamingGuards,
  parseJsonStringFields,
}: ProcessStreamingResultArgs): AsyncGenDeltaOut<OUT> {
  if (result.thought && result.thought.length > 0) {
    state.values[thoughtFieldName] =
      (state.values[thoughtFieldName] ?? '') + result.thought;
    yield {
      index: result.index,
      delta: { [thoughtFieldName]: result.thought } as Partial<OUT>,
    };
  }

  if (result.functionCalls && result.functionCalls.length > 0) {
    mergeFunctionCalls(state.functionCalls, result.functionCalls);
    mem.updateResult(
      {
        name: result.name,
        content: result.content,
        functionCalls: state.functionCalls,
        thoughtBlocks: result.thoughtBlocks,
        delta: result.functionCalls?.[0]?.function?.params as string,
        index: result.index,
      },
      sessionId
    );
  } else if (result.content && result.content.length > 0) {
    state.content += result.content;
    mem.updateResult(
      {
        name: result.name,
        content: state.content,
        thoughtBlocks: result.thoughtBlocks,
        delta: result.content,
        index: result.index,
      },
      sessionId
    );

    if (result.finishReason === 'length') {
      throw new Error(
        `Max tokens reached before completion\nContent: ${state.content}`
      );
    }

    if (signature.hasComplexFields()) {
      const accumulator = getOrCreateStructuredAccumulator(state);
      const parsed = parseStructuredPartial(state.content, accumulator);
      if (parsed) {
        let prepared: Record<string, unknown> | undefined;
        try {
          prepared = prepareStructuredPartialValues(
            signature,
            parsed.values,
            parseJsonStringFields
          );
          if (prepared) {
            validateStructuredPartialValues(
              signature,
              prepared,
              parsed.partialMarker
            );
          }
        } catch (e) {
          if (parsed.partialMarker && e instanceof ValidationError) {
            return;
          }
          throw e;
        }

        if (prepared) {
          const { delta, fullValues } = createStructuredDelta<OUT>({
            signature,
            parsedValues: prepared,
            previousValues: state.values,
            partialMarker: parsed.partialMarker,
          });
          Object.assign(state.values, fullValues);

          if (Object.keys(delta).length > 0) {
            yield {
              index: result.index,
              delta,
            };
          }
        }
        return;
      }
    }

    const skip = streamingExtractValues(
      signature,
      state.values,
      state.xstate,
      state.content,
      {
        strictMode,
        skipEarlyFail,
        treatAllFieldsOptional,
      }
    );

    if (skip) {
      return;
    }

    if (streamingGuards.length !== 0) {
      await checkStreamingGuards(streamingGuards, state.xstate, state.content);
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
  } else if (result.thought && result.thought.length > 0) {
    mem.updateResult(
      {
        name: result.name,
        content: state.content,
        delta: '',
        index: result.index,
        thought: result.thought,
        thoughtBlocks: result.thoughtBlocks,
      },
      sessionId
    );
  } else if (result.thoughtBlocks && result.thoughtBlocks.length > 0) {
    mem.updateResult(
      {
        name: result.name,
        content: state.content,
        delta: '',
        index: result.index,
        thoughtBlocks: result.thoughtBlocks,
      },
      sessionId
    );
  }

  if (result.finishReason === 'length') {
    throw new Error(
      `Max tokens reached before completion\nContent: ${state.content}`
    );
  }
}
