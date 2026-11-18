import { AxAIServiceAbortedError } from '../../util/apicall.js';
import { AxAgentProtocolCompletionSignal } from '../completion.js';
import type { AxCodeExecutionResult, AxCodeSession } from '../rlm.js';
import {
  formatInterpreterError,
  formatInterpreterOutput,
  hasCompletionSignalCall,
  isExecutionTimedOutError,
  isLikelyRuntimeErrorOutput,
  isSessionClosedError,
  looksLikePromisePlaceholder,
  parseRuntimeStateSnapshot,
  RUNTIME_RESTART_NOTICE,
  truncateText,
} from '../runtime.js';
import { buildGuidanceActionLogOutput } from './guidanceHelpers.js';
import type { TurnObservations } from './turnObservations.js';
import {
  AxAgentClarificationError,
  type AxAgentRuntimeCompletionState,
  type AxAgentTestResult,
} from './types.js';

export interface ExecutionHelperDeps {
  s: any;
  sessionRef: { current: AxCodeSession };
  effectiveAbortSignal?: AbortSignal;
  protectedRuntimeNames: string[];
  inspectReservedNames?: readonly string[];
  completionState: AxAgentRuntimeCompletionState;
  getMaxRuntimeChars: () => number;
  waitForCompletionSignal: () => Promise<void>;
  detectCompletionSignalCalls: boolean;
  createSession: () => AxCodeSession;
  observations: TurnObservations;
}

/** Outcome of running one actor turn's code in the runtime session. */
export type ActorCodeExecutionResult = {
  result: unknown;
  output: string;
  /** The turn failed; the action log tags it `error`. */
  isError: boolean;
  /**
   * The failure is an error in the code that the live session reported as
   * its result (`AxCodeSession.executeWithStatus()`) instead of rejecting, so
   * `output` is still the runtime's own text.
   */
  isCodeError?: boolean;
  /** The output includes completed host results alongside any guidance. */
  hasObservationFeedback?: boolean;
  executionPaused?: boolean;
  initializedBindings?: string[];
};

export interface ExecutionHelpers {
  dispose: () => void;
  executeActorCode: (code: string) => Promise<ActorCodeExecutionResult>;
  executeTestCode: (code: string) => Promise<AxAgentTestResult>;
}

export function buildExecutionHelpers(
  deps: ExecutionHelperDeps
): ExecutionHelpers {
  const {
    s,
    sessionRef,
    effectiveAbortSignal,
    protectedRuntimeNames,
    inspectReservedNames,
    completionState,
    getMaxRuntimeChars,
    waitForCompletionSignal,
    detectCompletionSignalCalls,
    createSession,
    observations,
  } = deps;

  const onAbort = () => observations.invalidate();
  if (effectiveAbortSignal?.aborted) onAbort();
  else effectiveAbortSignal?.addEventListener('abort', onAbort, { once: true });

  // Sessions without executeWithStatus() report every error by rejecting.
  const executeCode = (code: string): Promise<AxCodeExecutionResult> => {
    const session = sessionRef.current;
    const options = {
      signal: effectiveAbortSignal,
      reservedNames: protectedRuntimeNames,
    };
    return typeof session.executeWithStatus === 'function'
      ? session.executeWithStatus(code, options)
      : session.execute(code, options).then((value) => ({
          value,
          isError: false,
        }));
  };

  const withObservations = async (
    result: ActorCodeExecutionResult
  ): Promise<ActorCodeExecutionResult> => {
    const paused =
      result.isError && observations.isPause(result.result ?? result.output);
    let initializedBindings: string[] | undefined;
    if (observations.wasBlocked() && sessionRef.current.inspectGlobals) {
      try {
        const snapshot = parseRuntimeStateSnapshot(
          await sessionRef.current.inspectGlobals({
            signal: effectiveAbortSignal,
            reservedNames: inspectReservedNames ?? protectedRuntimeNames,
          })
        );
        initializedBindings = snapshot
          ?.filter((entry) => entry.type !== 'undefined')
          .map((entry) => entry.name);
      } catch (error) {
        effectiveAbortSignal?.throwIfAborted();
        if (s.shouldBubbleUserError(error)) throw error;
      }
    }
    const state = initializedBindings
      ? `Initialized bindings after pause: ${
          initializedBindings
            .slice(0, 24)
            .map((name) => name.slice(0, 80))
            .join(', ') || '(none)'
        }${initializedBindings.length > 24 ? ', …' : ''}.`
      : '';
    return {
      ...result,
      hasObservationFeedback: observations.hasObservations(),
      executionPaused: observations.wasBlocked(),
      initializedBindings,
      output: observations.render(
        getMaxRuntimeChars(),
        [paused ? '' : result.output, state].filter(Boolean).join('\n'),
        result.isError && !paused
      ),
      ...(paused ? { isError: false, isCodeError: false } : {}),
    };
  };

  const executeActorCode = async (
    code: string
  ): Promise<ActorCodeExecutionResult> => {
    const completionOutput = async (): Promise<ActorCodeExecutionResult> => {
      if (completionState.payload?.type === 'guide_agent') {
        return withObservations({
          result: undefined,
          output: buildGuidanceActionLogOutput(completionState.payload),
          isError: false,
        });
      }
      return {
        result: undefined,
        output: formatInterpreterOutput(undefined, getMaxRuntimeChars()),
        isError: false,
      };
    };

    try {
      const { value: result, isError: isCodeError } = await executeCode(code);
      await observations.waitForPending(effectiveAbortSignal);
      if (completionState.payload) {
        return completionOutput();
      }
      if (
        detectCompletionSignalCalls &&
        hasCompletionSignalCall(code) &&
        looksLikePromisePlaceholder(result)
      ) {
        await waitForCompletionSignal();
        if (completionState.payload) {
          return completionOutput();
        }
      }
      return withObservations({
        result,
        output: formatInterpreterOutput(result, getMaxRuntimeChars()),
        isError: isCodeError,
        isCodeError,
      });
    } catch (err) {
      if (observations.isPause(err)) {
        await observations.waitForPending(effectiveAbortSignal);
        return withObservations({
          result: undefined,
          output: '',
          isError: false,
        });
      }
      if (
        err instanceof AxAgentProtocolCompletionSignal ||
        completionState.payload
      ) {
        return completionOutput();
      }
      if (
        err instanceof AxAgentClarificationError ||
        err instanceof AxAIServiceAbortedError
      ) {
        observations.invalidate();
        throw err;
      }
      if (s.shouldBubbleUserError(err)) {
        throw err;
      }
      if (effectiveAbortSignal?.aborted) {
        observations.invalidate();
        throw new AxAIServiceAbortedError(
          'rlm-session',
          effectiveAbortSignal.reason ?? 'Aborted'
        );
      }
      if (
        err instanceof Error &&
        (err.name === 'AbortError' || err.message.startsWith('Aborted'))
      ) {
        observations.invalidate();
        throw err;
      }
      if (isExecutionTimedOutError(err)) {
        observations.invalidate();
        const limit = getMaxRuntimeChars();
        return {
          result: undefined,
          output: truncateText(
            `${RUNTIME_RESTART_NOTICE}\n${formatInterpreterError(err, limit)}`,
            limit
          ),
          isError: true,
        };
      }
      if (isSessionClosedError(err)) {
        try {
          observations.invalidate();
          sessionRef.current = createSession();
          completionState.payload = undefined;
          const { value: retryResult, isError: isCodeError } =
            await executeCode(code);
          await observations.waitForPending(effectiveAbortSignal);
          const retryLimit = getMaxRuntimeChars();
          return withObservations({
            result: retryResult,
            output: truncateText(
              `${RUNTIME_RESTART_NOTICE}\n${formatInterpreterOutput(retryResult, retryLimit)}`,
              retryLimit
            ),
            isError: isCodeError,
            isCodeError,
          });
        } catch (retryErr) {
          if (observations.isPause(retryErr)) {
            await observations.waitForPending(effectiveAbortSignal);
            return withObservations({
              result: undefined,
              output: RUNTIME_RESTART_NOTICE,
              isError: false,
            });
          }
          if (
            retryErr instanceof AxAgentProtocolCompletionSignal ||
            completionState.payload
          ) {
            return completionOutput();
          }
          if (
            retryErr instanceof AxAgentClarificationError ||
            retryErr instanceof AxAIServiceAbortedError ||
            effectiveAbortSignal?.aborted ||
            (retryErr instanceof Error && retryErr.name === 'AbortError')
          ) {
            observations.invalidate();
            throw retryErr;
          }
          if (s.shouldBubbleUserError(retryErr)) {
            throw retryErr;
          }
          if (!isExecutionTimedOutError(retryErr)) {
            await observations.waitForPending(effectiveAbortSignal);
          } else observations.invalidate();
          const retryErrLimit = getMaxRuntimeChars();
          return withObservations({
            result: undefined,
            output: truncateText(
              `${RUNTIME_RESTART_NOTICE}\n${formatInterpreterError(retryErr, retryErrLimit)}`,
              retryErrLimit
            ),
            isError: true,
          });
        }
      }
      await observations.waitForPending(effectiveAbortSignal);
      const errLimit = getMaxRuntimeChars();
      return withObservations({
        result: undefined,
        output: truncateText(formatInterpreterError(err, errLimit), errLimit),
        isError: true,
      });
    }
  };

  const executeTestCode = async (code: string): Promise<AxAgentTestResult> => {
    const normalizeTestCompletionResult = (): AxAgentTestResult => {
      if (!completionState.payload) {
        throw new Error('Expected completion payload');
      }

      if (completionState.payload.type === 'guide_agent') {
        return observations.render(
          getMaxRuntimeChars(),
          buildGuidanceActionLogOutput(completionState.payload)
        );
      }

      return completionState.payload;
    };

    let execution: AxCodeExecutionResult;
    try {
      execution = await executeCode(code);
      await observations.waitForPending(effectiveAbortSignal);
    } catch (err) {
      if (observations.isPause(err)) {
        await observations.waitForPending(effectiveAbortSignal);
        return observations.render(getMaxRuntimeChars());
      }
      if (
        err instanceof AxAgentProtocolCompletionSignal ||
        completionState.payload
      ) {
        if (completionState.payload) {
          return normalizeTestCompletionResult();
        }
      }
      if (
        err instanceof AxAgentClarificationError ||
        err instanceof AxAIServiceAbortedError ||
        effectiveAbortSignal?.aborted ||
        isExecutionTimedOutError(err)
      ) {
        observations.invalidate();
        throw err;
      }
      await observations.waitForPending(effectiveAbortSignal);
      if (observations.render(getMaxRuntimeChars())) {
        throw new Error(
          observations.render(
            getMaxRuntimeChars(),
            formatInterpreterError(err, getMaxRuntimeChars()),
            true
          ),
          { cause: err }
        );
      }
      throw err;
    }
    const { value: result, isError } = execution;
    if (
      detectCompletionSignalCalls &&
      hasCompletionSignalCall(code) &&
      looksLikePromisePlaceholder(result)
    ) {
      await waitForCompletionSignal();
    }
    if (completionState.payload) {
      return normalizeTestCompletionResult();
    }
    const output = formatInterpreterOutput(result, getMaxRuntimeChars());
    if (isError && observations.isPause(result)) {
      return observations.render(getMaxRuntimeChars());
    }
    if (isError || isLikelyRuntimeErrorOutput(output)) {
      throw new Error(observations.render(getMaxRuntimeChars(), output, true));
    }
    return observations.render(getMaxRuntimeChars(), output);
  };

  return {
    executeActorCode,
    executeTestCode,
    dispose: () => {
      effectiveAbortSignal?.removeEventListener('abort', onAbort);
      observations.invalidate();
    },
  };
}
