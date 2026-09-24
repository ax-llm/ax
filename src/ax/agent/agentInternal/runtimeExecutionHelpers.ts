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
  RUNTIME_RESTART_NOTICE,
  truncateText,
} from '../runtime.js';
import { buildGuidanceActionLogOutput } from './guidanceHelpers.js';
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
  completionState: AxAgentRuntimeCompletionState;
  getMaxRuntimeChars: () => number;
  waitForCompletionSignal: () => Promise<void>;
  detectCompletionSignalCalls: boolean;
  createSession: () => AxCodeSession;
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
};

export interface ExecutionHelpers {
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
    completionState,
    getMaxRuntimeChars,
    waitForCompletionSignal,
    detectCompletionSignalCalls,
    createSession,
  } = deps;

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

  const executeActorCode = async (
    code: string
  ): Promise<ActorCodeExecutionResult> => {
    const completionOutput = {
      result: undefined,
      output: formatInterpreterOutput(undefined, getMaxRuntimeChars()),
      isError: false,
    };

    try {
      const { value: result, isError: isCodeError } = await executeCode(code);
      if (completionState.payload) {
        return completionOutput;
      }
      if (
        detectCompletionSignalCalls &&
        hasCompletionSignalCall(code) &&
        looksLikePromisePlaceholder(result)
      ) {
        await waitForCompletionSignal();
        if (completionState.payload) {
          return completionOutput;
        }
      }
      return {
        result,
        output: formatInterpreterOutput(result, getMaxRuntimeChars()),
        isError: isCodeError,
        isCodeError,
      };
    } catch (err) {
      if (
        err instanceof AxAgentProtocolCompletionSignal ||
        completionState.payload
      ) {
        return completionOutput;
      }
      if (
        err instanceof AxAgentClarificationError ||
        err instanceof AxAIServiceAbortedError
      ) {
        throw err;
      }
      if (s.shouldBubbleUserError(err)) {
        throw err;
      }
      if (effectiveAbortSignal?.aborted) {
        throw new AxAIServiceAbortedError(
          'rlm-session',
          effectiveAbortSignal.reason ?? 'Aborted'
        );
      }
      if (
        err instanceof Error &&
        (err.name === 'AbortError' || err.message.startsWith('Aborted'))
      ) {
        throw err;
      }
      if (isExecutionTimedOutError(err)) {
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
          sessionRef.current = createSession();
          completionState.payload = undefined;
          const { value: retryResult, isError: isCodeError } =
            await executeCode(code);
          const retryLimit = getMaxRuntimeChars();
          return {
            result: retryResult,
            output: truncateText(
              `${RUNTIME_RESTART_NOTICE}\n${formatInterpreterOutput(retryResult, retryLimit)}`,
              retryLimit
            ),
            isError: isCodeError,
            isCodeError,
          };
        } catch (retryErr) {
          if (
            retryErr instanceof AxAgentClarificationError ||
            retryErr instanceof AxAIServiceAbortedError
          ) {
            throw retryErr;
          }
          if (s.shouldBubbleUserError(retryErr)) {
            throw retryErr;
          }
          const retryErrLimit = getMaxRuntimeChars();
          return {
            result: undefined,
            output: truncateText(
              `${RUNTIME_RESTART_NOTICE}\n${formatInterpreterError(retryErr, retryErrLimit)}`,
              retryErrLimit
            ),
            isError: true,
          };
        }
      }
      const errLimit = getMaxRuntimeChars();
      return {
        result: undefined,
        output: truncateText(formatInterpreterError(err, errLimit), errLimit),
        isError: true,
      };
    }
  };

  const executeTestCode = async (code: string): Promise<AxAgentTestResult> => {
    const normalizeTestCompletionResult = (): AxAgentTestResult => {
      if (!completionState.payload) {
        throw new Error('Expected completion payload');
      }

      if (completionState.payload.type === 'guide_agent') {
        return buildGuidanceActionLogOutput(completionState.payload);
      }

      return completionState.payload;
    };

    try {
      const result = await sessionRef.current.execute(code, {
        signal: effectiveAbortSignal,
        reservedNames: protectedRuntimeNames,
      });
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
      if (isLikelyRuntimeErrorOutput(output)) {
        throw new Error(output);
      }
      return output;
    } catch (err) {
      if (
        err instanceof AxAgentProtocolCompletionSignal ||
        completionState.payload
      ) {
        if (completionState.payload) {
          return normalizeTestCompletionResult();
        }
      }
      throw err;
    }
  };

  return { executeActorCode, executeTestCode };
}
