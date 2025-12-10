// ReadableStream is available globally in modern browsers and Node.js 16+

import type { AxChatResponse, AxModelUsage } from '../ai/types.js';
import { mergeFunctionCalls } from '../ai/util.js';
import type { AxAIMemory } from '../mem/types.js';
import { parsePartialJson } from '../util/partialJson.js';

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
  validateStructuredOutputValues,
} from './extract.js';
import {
  type AxFieldProcessor,
  processFieldProcessors,
  processStreamingFieldProcessors,
} from './fieldProcessor.js';
import { parseFunctionCalls, processFunctions } from './functions.js';
import type { AxResponseHandlerArgs, InternalAxGenState } from './generate.js';
// helper no longer used since memory removal is non-throwing
import type { AxSignature } from './sig.js';
import type { SignatureToolCallingManager } from './signatureToolCalling.js';
import type { AsyncGenDeltaOut, AxGenOut, DeltaOut } from './types.js';

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
  debug: boolean;
  functionResultFormatter?: (result: unknown) => string;
  signatureToolCallingManager: SignatureToolCallingManager | undefined;
  stopFunctionNames?: readonly string[];
  disableMemoryCleanup?: boolean;
};

export async function* processStreamingResponse<OUT extends AxGenOut>({
  res,
  usage,
  states,
  debug,
  ...args
}: ProcessStreamingResponseArgs): AsyncGenDeltaOut<OUT> {
  const skipEarlyFail =
    (args.ai.getFeatures().functionCot ?? false) &&
    args.functions !== undefined &&
    args.functions.length > 0;

  // Track latest modelUsage and aggregate citations across chunks
  let lastChunkUsage: AxModelUsage | undefined;
  const aggregatedCitations: NonNullable<AxModelUsage['citations']> = [];

  // Handle ReadableStream async iteration for browser compatibility
  const reader = res.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }
      const v = value;
      if (v.modelUsage) {
        lastChunkUsage = v.modelUsage;
      }

      for (const result of v.results) {
        // Collect citations if present
        if (Array.isArray(result.citations)) {
          for (const c of result.citations) {
            if (c?.url) {
              aggregatedCitations.push({
                url: c.url,
                title: c.title,
                description: c.description,
                license: c.license,
                publicationDate: c.publicationDate,
                snippet: c.snippet,
              });
            }
          }
        }

        if (
          (!result.content || result.content === '') &&
          (!result.thought || result.thought === '') &&
          (!result.thoughtBlocks || result.thoughtBlocks.length === 0) &&
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
          debug,
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
      debug,
    });
  }

  // Attach aggregated citations to usage and push (and log)
  if (lastChunkUsage) {
    if (aggregatedCitations.length) {
      const dedup = Array.from(
        new Map(
          aggregatedCitations
            .filter((c) => c.url)
            .map((c) => [c.url as string, c])
        ).values()
      );
      lastChunkUsage.citations = dedup;
    }
    usage.push(lastChunkUsage);
    // Emit usage log event when debug is enabled and logger is available
    if (debug && args.logger) {
      // Create a copy without citations for the usage event
      const usageWithoutCitations = structuredClone(lastChunkUsage);
      delete usageWithoutCitations.citations;

      args.logger({
        name: 'ChatResponseUsage',
        value: usageWithoutCitations,
      });

      // Emit separate citations event if they exist
      if (lastChunkUsage.citations && lastChunkUsage.citations.length > 0) {
        args.logger({
          name: 'ChatResponseCitations',
          value: lastChunkUsage.citations,
        });
      }
    }
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
    treatAllFieldsOptional?: boolean;
  }
>;

async function* ProcessStreamingResponse<OUT extends AxGenOut>({
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
        thoughtBlocks: result.thoughtBlocks,
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
        thoughtBlocks: result.thoughtBlocks,
        delta: result.content,
        index: result.index,
      },
      sessionId
    );

    // Check if we should use the partial JSON parser for structured outputs
    const outputFields = signature.getOutputFields();
    const hasComplexFields = signature.hasComplexFields();

    if (hasComplexFields) {
      // Try to parse partial JSON
      const partial = parsePartialJson(state.content);

      if (partial && typeof partial === 'object') {
        // If we have a valid object, yield it
        // Assuming the response schema matches the output fields structure
        // For 'json_schema' response format, the API usually returns the object directly matching the schema
        // We need to map this back to our fields if we used a wrapping object in schema generation

        // In generate.ts, we wrapped fields in a parent object if there were multiple output fields
        // If there was only one, we might still have wrapped it or not.
        // The current toJsonSchema usage in generate.ts wraps all fields in a root object properties.
        // So 'partial' corresponds to Record<string, any> where keys are field names.

        const delta: Partial<OUT> = {};
        for (const key of Object.keys(partial)) {
          // Only include fields that are part of the signature
          if (outputFields.some((f) => f.name === key)) {
            (delta as any)[key] = (partial as any)[key];
          }
        }

        // Validate structured output values against field constraints
        validateStructuredOutputValues(
          signature,
          delta as Record<string, unknown>,
          { allowMissingRequired: true }
        );

        // Update state values
        Object.assign(state.values, delta);

        yield {
          index: result.index,
          delta: delta as Partial<OUT>,
        };
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

    // Update memory with thought and thoughtBlocks
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
    // Handle case where we only have thoughtBlocks (e.g. signature delta)
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
  strictMode,
  excludeContentFromTrace,
  streamingAsserts,
  asserts,
  fieldProcessors,
  streamingFieldProcessors,
  functionResultFormatter,
  signatureToolCallingManager,
  logger,
  debug,
  stopFunctionNames,
}: FinalizeStreamingResponseArgs) {
  // Prefer native function calls when provided
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
      span,
      index: state.index,
      excludeContentFromTrace,
      functionResultFormatter,
      logger,
      debug: debug,
      stopFunctionNames,
    });
    state.functionsExecuted = new Set([...state.functionsExecuted, ...fx]);
    // Clear accumulated function calls after processing to avoid re-execution
    // in subsequent steps (prevents duplicate function results and loops)
    state.functionCalls = [];
  } else {
    const outputFields = signature.getOutputFields();
    const hasComplexFields = signature.hasComplexFields();

    let jsonParsed = false;
    if (hasComplexFields) {
      // For structured outputs, we try to parse the full JSON one last time
      // This ensures we catch any final closing braces that might have been missing in the stream
      try {
        const finalJson = JSON.parse(state.content);
        const delta: Partial<OUT> = {};
        for (const key of Object.keys(finalJson)) {
          if (outputFields.some((f) => f.name === key)) {
            (delta as any)[key] = finalJson[key];
          }
        }

        // Validate structured output values against field constraints
        validateStructuredOutputValues(
          signature,
          delta as Record<string, unknown>,
          { allowMissingRequired: true }
        );

        Object.assign(state.values, delta);
        yield {
          index: state.index,
          delta: delta as Partial<OUT>,
        };
        jsonParsed = true;
      } catch (e) {
        // Re-throw validation errors
        const errorMsg = ((e as Error).message || '').toLowerCase();
        if (
          errorMsg.includes('at least') ||
          errorMsg.includes('at most') ||
          errorMsg.includes('must match pattern') ||
          errorMsg.includes('invalid url') ||
          errorMsg.includes('required') ||
          errorMsg.includes('missing') ||
          errorMsg.includes('valid email') ||
          errorMsg.includes('number must be')
        ) {
          throw e;
        }
        // If JSON parse fails, we rely on partial parsing done during streaming
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

    // If no native function calls and prompt-mode is enabled, parse from text content
    if (signatureToolCallingManager) {
      const promptFuncs = await signatureToolCallingManager.processResults(
        state.values
      );

      if (promptFuncs && promptFuncs.length > 0) {
        if (!functions) {
          throw new Error('Functions are not defined');
        }

        // Mirror native function-call processing
        const fx = await processFunctions({
          ai,
          functionList: functions,
          functionCalls: promptFuncs,
          mem,
          sessionId,
          traceId,
          span,
          index: state.index,
          excludeContentFromTrace,
          functionResultFormatter,
          logger,
          debug,
          stopFunctionNames,
        });
        state.functionsExecuted = new Set([...state.functionsExecuted, ...fx]);

        // Record assistant functionCalls in memory for observability
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
        // After executing tools, skip further streaming of values in finalize
        return;
      }
    }

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

export async function* processResponse<OUT>({
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
  logger,
  debug,
  signatureToolCallingManager,
  stopFunctionNames,
  disableMemoryCleanup,
}: Readonly<AxResponseHandlerArgs<AxChatResponse>> & {
  states: InternalAxGenState[];
  usage: AxModelUsage[];
  excludeContentFromTrace: boolean;
  asserts: AxAssertion[];
  fieldProcessors: AxFieldProcessor[];
  thoughtFieldName: string;
  signature: AxSignature;
  debug: boolean;
  functionResultFormatter?: (result: unknown) => string;
  signatureToolCallingManager?: SignatureToolCallingManager;
  stopFunctionNames?: readonly string[];
  disableMemoryCleanup?: boolean;
}): AsyncGenDeltaOut<OUT> {
  const results = res.results ?? [];
  const treatAllFieldsOptional = signatureToolCallingManager !== undefined;

  mem.addResponse(results, sessionId);

  // Aggregate citations across results
  const citations: NonNullable<AxModelUsage['citations']> = [];
  for (const r of results) {
    if (Array.isArray(r?.citations)) {
      for (const c of r.citations) {
        if (c?.url) {
          citations.push({
            url: c.url,
            title: c.title,
            description: c.description,
            license: c.license,
            publicationDate: c.publicationDate,
            snippet: c.snippet,
          });
        }
      }
    }
  }

  for (const result of results) {
    const state = states[result.index];

    if (!state) {
      throw new Error(`No state found for result (index: ${result.index})`);
    }

    if (res.modelUsage) {
      const dedup = Array.from(
        new Map(
          citations.filter((c) => c.url).map((c) => [c.url as string, c])
        ).values()
      );
      const modelUsage: AxModelUsage = {
        ...res.modelUsage,
        ...(dedup.length ? { citations: dedup } : {}),
      };
      usage.push(modelUsage);
      if (debug && logger) {
        // Create a copy without citations for the usage event
        const usageWithoutCitations = structuredClone(modelUsage);
        delete usageWithoutCitations.citations;

        logger({
          name: 'ChatResponseUsage',
          value: usageWithoutCitations,
        });

        // Emit separate citations event if they exist
        if (modelUsage.citations && modelUsage.citations.length > 0) {
          logger({
            name: 'ChatResponseCitations',
            value: modelUsage.citations,
          });
        }
      }
    }

    // if signatureToolCallingManager is defined, we need to process the function calls and add update the result in memory
    if (signatureToolCallingManager && result.content) {
      if (result.thought && result.thought.length > 0) {
        state.values[thoughtFieldName] = result.thought;
      }

      extractValues(signature, state.values, result.content, {
        strictMode,
        treatAllFieldsOptional,
      });

      const promptFuncs = await signatureToolCallingManager.processResults(
        state.values
      );

      const functionCalls = promptFuncs?.map((fc) => ({
        id: fc.id,
        type: 'function' as const,
        function: { name: fc.name, params: fc.args },
      }));

      if (functionCalls && functionCalls.length > 0) {
        mem.updateResult(
          {
            name: result.name,
            content: result.content,
            functionCalls,
            index: result.index,
          },
          sessionId
        );
      }
    }

    if (result.functionCalls?.length) {
      const funcs = parseFunctionCalls(ai, result.functionCalls, state.values);
      if (funcs && funcs.length > 0) {
        if (!functions) {
          throw new Error('Functions are not defined');
        }

        let fx: Set<string> | undefined;
        try {
          fx = await processFunctions({
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
            logger,
            debug,
            stopFunctionNames,
          });
        } catch (e) {
          // On function error, tag and append correction prompt for next step
          mem.addRequest(
            [
              {
                role: 'user' as const,
                content:
                  'The previous tool call failed. Fix arguments and try again, ensuring required fields match schema.',
              },
            ],
            sessionId
          );
          mem.addTag('correction', sessionId);
          throw e;
        }

        state.functionsExecuted = new Set([...state.functionsExecuted, ...fx]);
      }
    } else if (result.content) {
      if (result.thought && result.thought.length > 0) {
        state.values[thoughtFieldName] = result.thought;
      }

      const outputFields = signature.getOutputFields();
      const hasComplexFields = signature.hasComplexFields();

      if (hasComplexFields) {
        try {
          const json = JSON.parse(result.content);
          const delta: Record<string, unknown> = {};
          for (const key of Object.keys(json)) {
            if (outputFields.some((f) => f.name === key)) {
              delta[key] = json[key];
            }
          }

          // Validate structured output values against field constraints
          validateStructuredOutputValues(signature, delta);

          Object.assign(state.values, delta);
        } catch (e) {
          // Re-throw validation errors - don't fallback for validation failures
          if (
            (e as Error).name?.includes('ValidationError') ||
            (e as Error).name?.includes('Error')
          ) {
            // Check if it's a validation error by looking at the error message patterns
            const errorMsg = ((e as Error).message || '').toLowerCase();
            if (
              errorMsg.includes('at least') ||
              errorMsg.includes('at most') ||
              errorMsg.includes('must match pattern') ||
              errorMsg.includes('invalid url') ||
              errorMsg.includes('required') ||
              errorMsg.includes('missing') ||
              errorMsg.includes('valid email') ||
              errorMsg.includes('number must be')
            ) {
              throw e;
            }
          }
          // fallback to extraction if JSON parse fails (shouldn't happen with strict mode)
          extractValues(signature, state.values, result.content, {
            strictMode,
            treatAllFieldsOptional,
          });
        }
      } else {
        extractValues(signature, state.values, result.content, {
          strictMode,
          treatAllFieldsOptional,
        });
      }
    }

    await assertAssertions(asserts, state.values);
    // If assertions passed, remove invalid-assistant and correction prompts
    if (!disableMemoryCleanup) {
      mem.removeByTag('correction', sessionId);
      mem.removeByTag('error', sessionId);
    }

    if (fieldProcessors.length) {
      await processFieldProcessors(
        fieldProcessors,
        state.values,
        mem,
        sessionId
      );
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
  stopFunction: readonly string[] | undefined,
  states: InternalAxGenState[],
  sessionId?: string
) {
  const lastMemItem = mem.getLast(sessionId);

  if (!lastMemItem) {
    return true;
  }

  for (const [index, state] of states.entries()) {
    const stopFunctionExecuted = stopFunction
      ? Array.from(stopFunction).some((s) => state.functionsExecuted.has(s))
      : false;

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
