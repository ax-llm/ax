import { assertAssertions, assertStreamingAssertions } from '../asserts.js';
import { ValidationError } from '../errors.js';
import { streamingExtractFinalValue, streamValues } from '../extract.js';
import {
  processFieldProcessors,
  processStreamingFieldProcessors,
} from '../fieldProcessor.js';
import { parseFunctionCalls, processFunctions } from '../functions.js';
import type { AxGenOut } from '../types.js';
import {
  createStructuredDelta,
  parseStructuredFinal,
} from './structuredDelta.js';
import type { FinalizeStreamingResponseArgs } from './types.js';

export async function* finalizeStreamingResponse<OUT extends AxGenOut>({
  state,
  signature,
  ai,
  model,
  functions,
  mem,
  sessionId,
  traceId,
  traceContext,
  tracer,
  span,
  strictMode,
  excludeContentFromTrace,
  streamingAsserts,
  asserts,
  fieldProcessors,
  streamingFieldProcessors,
  functionResultFormatter,
  signatureToolCallingManager,
  parseJsonStringFields,
  logger,
  debug,
  stopFunctionNames,
  stepContext,
  abortSignal,
  onFunctionCall,
  mcpExecutionContext,
  eventContext,
}: FinalizeStreamingResponseArgs) {
  const funcs = !signatureToolCallingManager
    ? parseFunctionCalls(ai, state.functionCalls, state.values, model)
    : undefined;

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
      traceContext,
      tracer,
      span,
      index: state.index,
      excludeContentFromTrace,
      functionResultFormatter,
      logger,
      debug,
      stopFunctionNames,
      step: stepContext,
      abortSignal,
      onFunctionCall,
      mcpExecutionContext,
      eventContext,
    });
    state.functionsExecuted = new Set([...state.functionsExecuted, ...fx]);
    state.functionCalls = [];
  } else {
    const hasComplexFields = signature.hasComplexFields();

    let jsonParsed = false;
    if (hasComplexFields) {
      try {
        const finalJson = parseStructuredFinal(
          signature,
          state.content,
          parseJsonStringFields
        );
        const { delta, fullValues } = createStructuredDelta<OUT>({
          signature,
          parsedValues: finalJson,
          previousValues: state.values,
          partialMarker: null,
        });

        Object.assign(state.values, fullValues);
        if (Object.keys(delta).length > 0) {
          yield {
            index: state.index,
            delta,
          };
        }
        jsonParsed = true;
      } catch (e) {
        if (e instanceof ValidationError) {
          throw e;
        }
        if (!(e instanceof SyntaxError)) {
          throw e;
        }
      }
    }

    if (!jsonParsed) {
      const treatAllFieldsOptional = signatureToolCallingManager !== undefined;
      streamingExtractFinalValue(
        signature,
        state.values,
        state.xstate,
        state.content,
        {
          strictMode,
          treatAllFieldsOptional,
          deferRequiredCheckForStreaming: true,
          forceFinalize: true,
        }
      );
    }

    if (signatureToolCallingManager) {
      const promptFuncs = await signatureToolCallingManager.processResults(
        state.values
      );

      if (promptFuncs && promptFuncs.length > 0) {
        if (!functions) {
          throw new Error('Functions are not defined');
        }

        const fx = await processFunctions({
          ai,
          functionList: functions,
          functionCalls: promptFuncs,
          mem,
          sessionId,
          traceId,
          traceContext,
          tracer,
          span,
          index: state.index,
          excludeContentFromTrace,
          functionResultFormatter,
          logger,
          debug,
          stopFunctionNames,
          step: stepContext,
          abortSignal,
          onFunctionCall,
          mcpExecutionContext,
          eventContext,
        });
        state.functionsExecuted = new Set([...state.functionsExecuted, ...fx]);

        mem.updateResult(
          {
            name: undefined,
            content: state.content,
            functionCalls: promptFuncs.map((fc) => ({
              id: fc.id,
              type: 'function' as const,
              function: { name: fc.name, params: fc.args },
            })),
            index: state.index,
          },
          sessionId
        );
        return;
      }
    }

    await assertStreamingAssertions(
      streamingAsserts,
      state.xstate,
      state.content,
      true
    );

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

    if (asserts.length) {
      await assertAssertions(asserts, state.values);
    }

    if (!jsonParsed) {
      yield* streamValues<OUT>(
        signature,
        state.content,
        state.values as Record<string, OUT>,
        state.xstate,
        state.index
      );
    }
  }
}
