import type {
  AxGenIn,
  AxProgramForwardOptions,
  AxProgramUsage,
} from '../../dsp/types.js';
import { AxAIServiceAbortedError } from '../../util/apicall.js';
import type {
  AxAgentGuidancePayload,
  AxAgentInternalCompletionPayload,
} from '../completion.js';
import {
  computeEffectiveChatBudget,
  getActorModelConsecutiveErrorTurns,
  getActorModelMatchedNamespaces,
  selectActorModelFromPolicy,
} from '../config.js';
import { manageContext } from '../contextManager.js';
import { normalizeActorJavascriptCode } from '../optimize.js';
import {
  formatBubbledActorTurnOutput,
  validateActorTurnCodePolicy,
} from '../runtime.js';
import type { ActorLoopContext } from './actorLoopContext.js';
import {
  appendDiscoveryTurnSummary,
  stripDiscoveryTurnOutput,
} from './discoveryHelpers.js';
import {
  buildGuidanceActionLogCode,
  buildGuidanceActionLogOutput,
  renderGuidanceLog,
  snapshotChatLogMessages,
} from './guidanceHelpers.js';
import { AxAgentClarificationError } from './types.js';

const ACTOR_CODE_POLICY_GUIDANCE =
  'Your previous Javascript Code value did not satisfy the executable-code turn contract. ' +
  'On this turn, set Javascript Code to runnable JavaScript only: use console.log(...) for inspection, ' +
  'await final("...", { ... }) when complete, or await askClarification(...) when blocked. ' +
  'Do not emit plain task:/evidence: labels or prose as the Javascript Code value.';

export async function runActorTurn<_IN extends AxGenIn>(
  ctx: ActorLoopContext,
  turn: number,
  _options: Readonly<AxProgramForwardOptions<string>> | undefined,
  _effectiveAbortSignal: AbortSignal | undefined,
  applyInputUpdateCallback: () => Promise<void>,
  _maxTurns: number
): Promise<{ shouldBreak: boolean; shouldContinue: boolean }> {
  const {
    s,
    ai,
    rlm,
    runtimeContext,
    inputState,
    completionState,
    guidanceState,
    actionLogEntries,
    actorMergedOptions,
    summaryForwardOptions,
    explicitActorDebugHideSystemPrompt,
    contextThreshold,
    mutableState,
    helpers,
  } = ctx;

  const {
    refreshActorInstruction,
    buildActorPromptValues,
    measureActorPromptChars,
    renderActionLogParts,
    resetActorModelErrorState,
    noteActorTurnErrorState,
    syncDiscoveredActorModelNamespaces,
    refreshCheckpointSummary,
  } = helpers;

  const actorInstruction = refreshActorInstruction();
  await applyInputUpdateCallback();
  inputState.recomputeTurnInputs(true);
  if (await refreshCheckpointSummary()) {
    resetActorModelErrorState();
  }

  const { summary: baseSummarizedActorLog, history: baseHistoryText } =
    renderActionLogParts();
  const summarizedActorLogText = baseSummarizedActorLog || undefined;
  let actionLogText = baseHistoryText || '(no actions yet)';
  const guidanceLogText = renderGuidanceLog(guidanceState.entries);
  const inspectMetrics = await measureActorPromptChars(
    actionLogText,
    guidanceLogText,
    mutableState.runtimeStateSummary,
    summarizedActorLogText
  );
  const inspectFixedOverhead =
    inspectMetrics.systemPromptCharacters +
    inspectMetrics.exampleChatContextCharacters;
  if (
    contextThreshold &&
    inspectMetrics.mutableChatContextCharacters >
      computeEffectiveChatBudget(contextThreshold, inspectFixedOverhead)
  ) {
    actionLogText +=
      '\n\n[HINT: Actor prompt is large. Call `const state = await inspect_runtime()` for a compact snapshot of current variables instead of re-reading old outputs.]';
  }

  let actorCallOptions = actorMergedOptions;
  if (s.actorModelPolicy) {
    syncDiscoveredActorModelNamespaces();
    const selectedModel = selectActorModelFromPolicy(
      s.actorModelPolicy,
      getActorModelConsecutiveErrorTurns(mutableState.actorModelState),
      getActorModelMatchedNamespaces(mutableState.actorModelState)
    );
    actorCallOptions =
      selectedModel !== undefined
        ? {
            ...actorMergedOptions,
            model: selectedModel,
          }
        : actorMergedOptions;
  }

  const debugHideSystemPrompt =
    explicitActorDebugHideSystemPrompt ??
    (turn > 0 &&
      actorInstruction === mutableState.lastDebugLoggedActorInstruction);
  actorCallOptions = {
    ...actorCallOptions,
    debugHideSystemPrompt,
  };

  const usageBefore = s.actorProgram.getUsage()?.length ?? 0;

  const actorResult = await s.actorProgram.forward(
    ai,
    buildActorPromptValues(
      actionLogText,
      guidanceLogText,
      mutableState.runtimeStateSummary,
      summarizedActorLogText
    ),
    actorCallOptions
  );
  if (!debugHideSystemPrompt) {
    mutableState.lastDebugLoggedActorInstruction = actorInstruction;
  }

  // Capture per-turn metadata for the callback.
  const turnUsage = rlm.actorTurnCallback
    ? (s.actorProgram.getUsage()?.slice(usageBefore) as
        | AxProgramUsage[]
        | undefined)
    : undefined;
  const turnModel =
    actorCallOptions.model !== undefined
      ? String(actorCallOptions.model)
      : undefined;
  const turnChatLogMessages = rlm.actorTurnCallback
    ? snapshotChatLogMessages(s.actorProgram.getChatLog())
    : undefined;

  if (turn === 0) {
    mutableState.restoreNotice = undefined;
  }

  let code = actorResult.javascriptCode as string | undefined;
  const trimmedCode = code?.trim();
  if (!code || !trimmedCode) {
    return { shouldBreak: true, shouldContinue: false };
  }
  code = normalizeActorJavascriptCode(trimmedCode);
  actorResult.javascriptCode = code;

  for (const fieldName of s.actorFieldNames) {
    if (fieldName in actorResult) {
      mutableState.actorFieldValues[fieldName] = actorResult[fieldName];
    }
  }

  let actorFieldsOutput = '';
  if (s.actorFieldNames.length > 0) {
    const fieldEntries = s.actorFieldNames
      .filter((name: string) => name in actorResult)
      .map((name: string) => `${name}: ${actorResult[name]}`)
      .join('\n');
    if (fieldEntries) {
      actorFieldsOutput = `\nActor fields:\n${fieldEntries}`;
    }
  }

  completionState.payload = undefined;

  if (s.enforceIncrementalConsoleTurns) {
    const policyResult = validateActorTurnCodePolicy(code);

    // Auto-split: discovery mixed with other code — run discovery first,
    // then proceed to execute the full code block (discovery calls are
    // idempotent so re-running is safe).
    if (policyResult?.autoSplitDiscoveryCode) {
      await runtimeContext.executeActorCode(
        policyResult.autoSplitDiscoveryCode
      );
    }

    if (policyResult?.violation) {
      const policyViolation = policyResult.violation;
      const entryTurn = actionLogEntries.length + 1;
      guidanceState.entries.push({
        turn: entryTurn,
        guidance: ACTOR_CODE_POLICY_GUIDANCE,
        triggeredBy: 'runtime policy',
      });
      actionLogEntries.push({
        turn: entryTurn,
        code,
        output: policyViolation,
        actorFieldsOutput,
        tags: ['error'],
      });

      if (rlm.actorTurnCallback) {
        await rlm.actorTurnCallback({
          turn: entryTurn,
          actionLogEntryCount: actionLogEntries.length,
          guidanceLogEntryCount: guidanceState.entries.length,
          actorResult: actorResult as Record<string, unknown>,
          code,
          result: undefined,
          output: policyViolation,
          isError: true,
          thought:
            typeof actorResult.thought === 'string'
              ? actorResult.thought
              : undefined,
          usage: turnUsage,
          model: turnModel,
          chatLogMessages: turnChatLogMessages,
        });
      }

      await manageContext(
        actionLogEntries,
        actionLogEntries.length - 1,
        runtimeContext.effectiveContextConfig,
        ai,
        summaryForwardOptions
      );
      noteActorTurnErrorState(true);
      if (await refreshCheckpointSummary()) {
        resetActorModelErrorState();
      }
      return { shouldBreak: false, shouldContinue: true };
    }
  }

  if (s.inputUpdateCallback) {
    await runtimeContext.syncRuntimeInputsToSession();
  }
  let result: unknown;
  let output: string;
  let isError: boolean;

  try {
    const executionResult = await runtimeContext.executeActorCode(code);
    result = executionResult.result;
    output = executionResult.output;
    isError = executionResult.isError;
  } catch (err) {
    if (
      err instanceof AxAgentClarificationError ||
      err instanceof AxAIServiceAbortedError ||
      s.shouldBubbleUserError(err)
    ) {
      const bubbledError = err instanceof Error ? err : new Error(String(err));
      if (rlm.actorTurnCallback) {
        await rlm.actorTurnCallback({
          turn: actionLogEntries.length + 1,
          actionLogEntryCount: actionLogEntries.length,
          guidanceLogEntryCount: guidanceState.entries.length,
          actorResult: actorResult as Record<string, unknown>,
          code,
          result: undefined,
          output: formatBubbledActorTurnOutput(
            bubbledError,
            runtimeContext.effectiveContextConfig.maxRuntimeChars
          ),
          isError:
            err instanceof AxAIServiceAbortedError ||
            s.shouldBubbleUserError(err),
          thought:
            typeof actorResult.thought === 'string'
              ? actorResult.thought
              : undefined,
          usage: turnUsage,
          model: turnModel,
          chatLogMessages: turnChatLogMessages,
        });
      }
    }
    throw err;
  }

  const completionPayload = completionState.payload as
    | AxAgentInternalCompletionPayload
    | undefined;
  const guidancePayload =
    completionPayload?.type === 'guide_agent'
      ? (completionPayload as AxAgentGuidancePayload)
      : undefined;
  if (guidancePayload) {
    const nextTurn = actionLogEntries.length + 1;
    guidanceState.entries.push({
      turn: nextTurn,
      guidance: guidancePayload.guidance,
      ...(guidancePayload.triggeredBy
        ? { triggeredBy: guidancePayload.triggeredBy }
        : {}),
    });
    result = undefined;
    output = buildGuidanceActionLogOutput(guidancePayload);
    isError = false;
  }

  const discoveryTurnArtifacts = runtimeContext.consumeDiscoveryTurnArtifacts();
  if (!isError) {
    output = stripDiscoveryTurnOutput(output, discoveryTurnArtifacts.texts);
    output = appendDiscoveryTurnSummary(output, discoveryTurnArtifacts.summary);
  }

  const entryTurn = actionLogEntries.length + 1;
  const actionLogCode = guidancePayload
    ? buildGuidanceActionLogCode(guidancePayload)
    : code;
  actionLogEntries.push({
    turn: entryTurn,
    code: actionLogCode,
    output,
    actorFieldsOutput,
    tags: isError ? ['error'] : [],
  });

  if (rlm.actorTurnCallback) {
    await rlm.actorTurnCallback({
      turn: entryTurn,
      actionLogEntryCount: actionLogEntries.length,
      guidanceLogEntryCount: guidanceState.entries.length,
      actorResult: actorResult as Record<string, unknown>,
      code,
      result,
      output,
      isError,
      thought:
        typeof actorResult.thought === 'string'
          ? actorResult.thought
          : undefined,
      usage: turnUsage,
      model: turnModel,
      chatLogMessages: turnChatLogMessages,
    });
  }

  await manageContext(
    actionLogEntries,
    actionLogEntries.length - 1,
    runtimeContext.effectiveContextConfig,
    ai,
    summaryForwardOptions
  );
  if (!isError) {
    mutableState.runtimeStateSummary =
      await runtimeContext.captureRuntimeStateSummary();
  }
  noteActorTurnErrorState(isError);
  if (await refreshCheckpointSummary()) {
    resetActorModelErrorState();
  }

  if (completionState.payload && 'guidance' in completionState.payload) {
    completionState.payload = undefined;
    return { shouldBreak: false, shouldContinue: true };
  }

  if (completionState.payload) {
    return { shouldBreak: true, shouldContinue: false };
  }

  return { shouldBreak: false, shouldContinue: false };
}
