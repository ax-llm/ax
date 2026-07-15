import type { AxAIService } from '../../ai/types.js';
import { AxGen } from '../../dsp/generate.js';
import type { AxSignature } from '../../dsp/sig.js';
import type { AxFieldValue, AxProgramForwardOptions } from '../../dsp/types.js';
import { axMCPChildExecutionOptions } from '../../mcp/execution.js';
import { mergeAbortSignals } from '../../util/abort.js';
import { AxAIServiceAbortedError } from '../../util/apicall.js';
import {
  isTransientError,
  runWithConcurrency,
  TEST_HARNESS_LLM_QUERY_AI_REQUIRED_ERROR,
  truncateText,
} from '../runtime.js';
import type {
  AxAgentRecursionOptions,
  AxLlmQueryBudgetState,
} from './types.js';
import { AxAgentClarificationError } from './types.js';

export interface LlmQueryBindingsDeps {
  self: any;
  ai?: AxAIService;
  debug: boolean;
  effectiveAbortSignal?: AbortSignal;
  llmQueryBudgetState: AxLlmQueryBudgetState;
  maxBatchedLlmQueryConcurrency: number;
  recursionForwardOptions: AxAgentRecursionOptions;
  parentForwardOptions: Partial<
    Omit<AxProgramForwardOptions<string>, 'functions'>
  >;
  simpleChildSignature: AxSignature;
  llmCallWarnThreshold: number;
  getMaxRuntimeChars: () => number;
}

export interface LlmQueryBindings {
  llmQuery: (
    queryOrQueries:
      | string
      | { query: string; context?: unknown }
      | readonly { query: string; context?: unknown }[],
    ctx?: unknown
  ) => Promise<string | string[]>;
}

export function buildLlmQueryBindings(
  deps: LlmQueryBindingsDeps
): LlmQueryBindings {
  const {
    self,
    ai,
    debug,
    effectiveAbortSignal,
    llmQueryBudgetState,
    maxBatchedLlmQueryConcurrency,
    recursionForwardOptions,
    parentForwardOptions,
    simpleChildSignature,
    llmCallWarnThreshold,
    getMaxRuntimeChars,
  } = deps;
  const s = self as any;

  const createSimpleSubAgent = () =>
    new AxGen<any, { answer: AxFieldValue }>(
      simpleChildSignature,
      recursionForwardOptions
    );

  const llmQuery = async (
    queryOrQueries:
      | string
      | { query: string; context?: unknown }
      | readonly { query: string; context?: unknown }[],
    ctx?: unknown
  ): Promise<string | string[]> => {
    if (
      !Array.isArray(queryOrQueries) &&
      typeof queryOrQueries === 'object' &&
      queryOrQueries !== null &&
      'query' in queryOrQueries
    ) {
      return llmQuery(queryOrQueries.query, queryOrQueries.context ?? ctx);
    }

    if (effectiveAbortSignal?.aborted) {
      throw new AxAIServiceAbortedError(
        'rlm-llm-query',
        effectiveAbortSignal.reason
          ? String(effectiveAbortSignal.reason)
          : 'Aborted'
      );
    }

    if (!ai) {
      throw new Error(TEST_HARNESS_LLM_QUERY_AI_REQUIRED_ERROR);
    }

    const query = queryOrQueries as string;
    const normalizeSubAgentAnswer = (value: AxFieldValue): string => {
      if (value === undefined || value === null) {
        return '';
      }
      const limit = getMaxRuntimeChars();
      if (typeof value === 'string') {
        return truncateText(value, limit);
      }
      try {
        return truncateText(JSON.stringify(value), limit);
      } catch {
        return truncateText(String(value), limit);
      }
    };

    const runSingleLlmQuery = async (
      singleQuery: string,
      singleCtx?: unknown,
      abortSignal: AbortSignal | undefined = effectiveAbortSignal
    ): Promise<string> => {
      if (abortSignal?.aborted) {
        throw new AxAIServiceAbortedError(
          'rlm-llm-query',
          abortSignal.reason ? String(abortSignal.reason) : 'Aborted'
        );
      }

      const normalizedCtx =
        singleCtx === undefined ||
        singleCtx === null ||
        (typeof singleCtx === 'string' && !singleCtx.trim()) ||
        (typeof singleCtx === 'object' &&
          Object.keys(singleCtx as object).length === 0)
          ? undefined
          : typeof singleCtx === 'string'
            ? truncateText(singleCtx, getMaxRuntimeChars())
            : singleCtx;

      if (llmQueryBudgetState.global.used >= llmQueryBudgetState.globalMax) {
        return `[ERROR] Global sub-query budget exhausted (${llmQueryBudgetState.globalMax}/${llmQueryBudgetState.globalMax}). Complete the task using data already gathered or handle remaining work directly in JS.`;
      }
      if (llmQueryBudgetState.localUsed >= llmQueryBudgetState.localMax) {
        return `[ERROR] Per-agent sub-query budget exhausted (${llmQueryBudgetState.localMax}/${llmQueryBudgetState.localMax}). Complete the task using data already gathered or handle remaining work directly in JS.`;
      }
      llmQueryBudgetState.global.used++;
      llmQueryBudgetState.localUsed++;

      const maxAttempts = 3;
      let lastError: unknown;
      const formatSubAgentError = (error: unknown) =>
        `[ERROR] ${error instanceof Error ? error.message : String(error)}. Retry with a simpler query, handle in JS, or proceed with data already gathered.`;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const simpleSubAgent = createSimpleSubAgent();
          const { ai: recursionAiOverride, ...recursionRestOptions } =
            recursionForwardOptions as {
              ai?: Readonly<AxAIService>;
              [k: string]: unknown;
            };
          const recursionAi = recursionAiOverride ?? ai;
          const childOptions = axMCPChildExecutionOptions({
            ...(parentForwardOptions as Partial<
              Omit<AxProgramForwardOptions<string>, 'functions'>
            >),
            ...(recursionRestOptions as Partial<
              Omit<AxProgramForwardOptions<string>, 'functions'>
            >),
            abortSignal,
            debug,
          });
          const simpleResult = await simpleSubAgent.forward(
            recursionAi,
            {
              task: singleQuery,
              ...(normalizedCtx !== undefined
                ? { context: normalizedCtx }
                : {}),
            },
            childOptions
          );
          return normalizeSubAgentAnswer(simpleResult.answer);
        } catch (err) {
          if (
            err instanceof AxAIServiceAbortedError ||
            err instanceof AxAgentClarificationError
          ) {
            throw err;
          }
          if (s.shouldBubbleUserError(err)) {
            throw err;
          }
          lastError = err;
          if (!isTransientError(err) || attempt >= maxAttempts - 1) {
            return formatSubAgentError(err);
          }
          const delay = Math.min(60_000, 1000 * Math.pow(2, attempt));
          await new Promise<void>((resolve, reject) => {
            let settled = false;
            let onAbort: (() => void) | undefined;

            const cleanup = () => {
              if (abortSignal && onAbort) {
                abortSignal.removeEventListener('abort', onAbort);
              }
            };

            const onResolve = () => {
              if (settled) {
                return;
              }
              settled = true;
              cleanup();
              resolve();
            };

            const timer = setTimeout(onResolve, delay);
            if (!abortSignal) {
              return;
            }

            onAbort = () => {
              if (settled) {
                return;
              }
              settled = true;
              clearTimeout(timer);
              cleanup();
              reject(
                new AxAIServiceAbortedError(
                  'rlm-llm-query-retry-backoff',
                  abortSignal.reason
                    ? String(abortSignal.reason)
                    : 'Aborted during retry backoff'
                )
              );
            };

            if (abortSignal.aborted) {
              onAbort();
              return;
            }

            abortSignal.addEventListener('abort', onAbort, {
              once: true,
            });
          });
        }
      }

      return formatSubAgentError(lastError);
    };

    if (Array.isArray(queryOrQueries)) {
      const batchAbortController = new AbortController();
      const batchAbortSignal =
        mergeAbortSignals(effectiveAbortSignal, batchAbortController.signal) ??
        batchAbortController.signal;
      let terminalBatchError:
        | AxAgentClarificationError
        | AxAIServiceAbortedError
        | undefined;

      try {
        return await runWithConcurrency(
          queryOrQueries,
          maxBatchedLlmQueryConcurrency,
          async (q) => {
            try {
              return await runSingleLlmQuery(
                q.query,
                q.context,
                batchAbortSignal
              );
            } catch (err) {
              if (
                err instanceof AxAIServiceAbortedError ||
                err instanceof AxAgentClarificationError
              ) {
                if (
                  err instanceof AxAgentClarificationError ||
                  !terminalBatchError
                ) {
                  terminalBatchError = err;
                }
                if (!batchAbortController.signal.aborted) {
                  batchAbortController.abort(
                    err instanceof AxAgentClarificationError
                      ? 'Child clarification'
                      : err.message
                  );
                }
                throw terminalBatchError;
              }
              if (s.shouldBubbleUserError(err)) {
                if (!batchAbortController.signal.aborted) {
                  batchAbortController.abort('User bubble error');
                }
                throw err;
              }
              return `[ERROR] ${err instanceof Error ? err.message : String(err)}`;
            }
          },
          batchAbortSignal
        );
      } finally {
        // batchAbortSignal cleanup is handled by mergeAbortSignals
      }
    }

    const result = await runSingleLlmQuery(query, ctx);
    if (llmQueryBudgetState.localUsed === llmCallWarnThreshold) {
      const remaining =
        llmQueryBudgetState.localMax - llmQueryBudgetState.localUsed;
      return `${result}\n[WARNING] ${llmQueryBudgetState.localUsed}/${llmQueryBudgetState.localMax} sub-queries used (${remaining} remaining). Consolidate remaining work.`;
    }
    return result;
  };

  return { llmQuery };
}
