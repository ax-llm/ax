import { ValidationError } from '../errors.js';
import { extractValues } from '../extract.js';
import { processFieldProcessors } from '../fieldProcessor.js';
import { parseFunctionCalls, processFunctions } from '../functions.js';
import type { AsyncGenDeltaOut, AxGenOut, DeltaOut } from '../types.js';
import { parseStructuredFinal, selectOutputFields } from './structuredDelta.js';
import type { ProcessResponseBaseArgs } from './types.js';
import { collectResultCitations, pushAndLogUsage } from './usage.js';

export async function* processResponse<OUT extends AxGenOut>({
  ai,
  res,
  mem,
  sessionId,
  traceId,
  traceContext,
  tracer,
  functions,
  span,
  strictMode,
  states,
  usage,
  excludeContentFromTrace,
  fieldProcessors,
  thoughtFieldName,
  signature,
  parseJsonStringFields,
  debugPromptMetrics,
  functionResultFormatter,
  logger,
  debug,
  signatureToolCallingManager,
  stopFunctionNames,
  disableMemoryCleanup,
  stepContext,
  abortSignal,
  onFunctionCall,
}: ProcessResponseBaseArgs): AsyncGenDeltaOut<OUT> {
  const results = res.results ?? [];
  const treatAllFieldsOptional = signatureToolCallingManager !== undefined;

  mem.addResponse(results, sessionId);

  pushAndLogUsage({
    ai,
    usage,
    modelUsage: res.modelUsage,
    citations: collectResultCitations(results),
    debug,
    logger,
    debugPromptMetrics,
  });

  for (const result of results) {
    const state = states[result.index];

    if (!state) {
      throw new Error(`No state found for result (index: ${result.index})`);
    }

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

    if (result.thought && result.thought.length > 0) {
      state.values[thoughtFieldName] = result.thought;
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
            traceContext,
            tracer,
            span,
            excludeContentFromTrace,
            index: result.index,
            functionResultFormatter,
            logger,
            debug,
            stopFunctionNames,
            step: stepContext,
            abortSignal,
            onFunctionCall,
          });
        } catch (e) {
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
      if (signature.hasComplexFields()) {
        try {
          const json = parseStructuredFinal(
            signature,
            result.content,
            parseJsonStringFields
          );
          Object.assign(state.values, selectOutputFields(signature, json));
        } catch (e) {
          if (e instanceof SyntaxError) {
            extractValues(signature, state.values, result.content, {
              strictMode,
              treatAllFieldsOptional,
            });
          } else if (e instanceof ValidationError) {
            throw e;
          } else {
            throw e;
          }
        }
      } else {
        extractValues(signature, state.values, result.content, {
          strictMode,
          treatAllFieldsOptional,
        });
      }
    }

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
    if (v[thoughtFieldName] !== undefined) {
      delta[thoughtFieldName] = v[thoughtFieldName];
    }
    return { index, delta: delta as Partial<OUT> };
  });

  for (const delta of deltas) {
    yield delta;
  }
}
