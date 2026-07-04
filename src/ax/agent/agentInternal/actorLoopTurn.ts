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
import {
  classifyContextPressure,
  emitContextEvent,
  renderContextPressure,
} from '../contextEvents.js';
import { manageContext } from '../contextManager.js';
import { normalizeActorCode } from '../optimize.js';
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
  appendGuidanceEntry,
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
    functionCallRecords,
    explicitActorDebugHideSystemPrompt,
    contextStage,
    contextThreshold,
    mutableState,
    helpers,
  } = ctx;

  const {
    refreshActorInstruction,
    buildActorPromptValues,
    measureActorPromptChars,
    renderActionLogParts,
    renderActionLogPartsWithReplayMode,
    resetActorModelErrorState,
    noteActorTurnErrorState,
    syncDiscoveredActorModelNamespaces,
    refreshCheckpointSummary,
  } = helpers;

  const actorInstruction = refreshActorInstruction();
  await applyInputUpdateCallback();
  inputState.recomputeTurnInputs(true);
  for (const promotion of inputState.drainAutoPromotionEvents()) {
    await emitContextEvent(s.onContextEvent, {
      kind: 'field_auto_promoted',
      stage: contextStage,
      turn: turn + 1,
      ...promotion,
    });
  }
  if (await refreshCheckpointSummary(actionLogEntries.length)) {
    resetActorModelErrorState();
  }

  let actionLogParts = renderActionLogParts();
  let summarizedActorLogText = actionLogParts.summary || undefined;
  let actionLogText = actionLogParts.history || '(no actions yet)';
  const guidanceLogText = renderGuidanceLog(guidanceState.entries);
  let inspectMetrics = await measureActorPromptChars(
    actionLogText,
    guidanceLogText,
    mutableState.runtimeStateSummary,
    summarizedActorLogText
  );
  let inspectFixedOverhead =
    inspectMetrics.systemPromptCharacters +
    inspectMetrics.exampleChatContextCharacters;
  let effectiveBudgetChars = computeEffectiveChatBudget(
    runtimeContext.effectiveContextConfig.targetPromptChars,
    inspectFixedOverhead
  );
  const checkpointActive = Boolean(mutableState.checkpointState);
  let pressure = classifyContextPressure({
    mutablePromptChars: inspectMetrics.mutableChatContextCharacters,
    effectiveBudgetChars,
    checkpointActive,
  });
  const pressureHygieneMode =
    runtimeContext.effectiveContextConfig.contextHygiene?.pressureMode;
  const defaultHygieneMode =
    runtimeContext.effectiveContextConfig.contextHygiene?.defaultMode ?? 'none';
  if (
    pressure !== 'ok' &&
    pressureHygieneMode &&
    pressureHygieneMode !== defaultHygieneMode
  ) {
    const cps = mutableState.checkpointState;
    const pressureParts = renderActionLogPartsWithReplayMode(
      runtimeContext.effectiveContextConfig.actionReplay,
      cps?.summary,
      cps?.turns,
      pressureHygieneMode
    );
    const pressureActionLogText = pressureParts.history || '(no actions yet)';
    const pressureSummarizedActorLogText = pressureParts.summary || undefined;
    const pressureMetrics = await measureActorPromptChars(
      pressureActionLogText,
      guidanceLogText,
      mutableState.runtimeStateSummary,
      pressureSummarizedActorLogText
    );
    if (
      pressureMetrics.mutableChatContextCharacters <
      inspectMetrics.mutableChatContextCharacters
    ) {
      actionLogParts = pressureParts;
      actionLogText = pressureActionLogText;
      summarizedActorLogText = pressureSummarizedActorLogText;
      inspectMetrics = pressureMetrics;
      inspectFixedOverhead =
        inspectMetrics.systemPromptCharacters +
        inspectMetrics.exampleChatContextCharacters;
      effectiveBudgetChars = computeEffectiveChatBudget(
        runtimeContext.effectiveContextConfig.targetPromptChars,
        inspectFixedOverhead
      );
      pressure = classifyContextPressure({
        mutablePromptChars: inspectMetrics.mutableChatContextCharacters,
        effectiveBudgetChars,
        checkpointActive,
      });
    }
  }
  const contextPressureText =
    runtimeContext.effectiveContextConfig.preset !== 'full'
      ? renderContextPressure(pressure)
      : undefined;
  for (const compaction of actionLogParts.compactions) {
    await emitContextEvent(s.onContextEvent, {
      kind: 'action_compacted',
      stage: contextStage,
      turn: compaction.turn,
      mode: compaction.mode,
      reason: compaction.reason,
      originalChars: compaction.originalChars,
      renderedChars: compaction.renderedChars,
    });
  }
  await emitContextEvent(s.onContextEvent, {
    kind: 'budget_check',
    stage: contextStage,
    turn: turn + 1,
    pressure,
    mutablePromptChars: inspectMetrics.mutableChatContextCharacters,
    fixedPromptChars: inspectFixedOverhead,
    effectiveBudgetChars,
    targetPromptChars: runtimeContext.effectiveContextConfig.targetPromptChars,
    checkpointActive,
    actionLogEntryCount: actionLogEntries.length,
    guidanceLogEntryCount: guidanceState.entries.length,
  });
  if (
    contextThreshold &&
    inspectMetrics.mutableChatContextCharacters >
      computeEffectiveChatBudget(contextThreshold, inspectFixedOverhead)
  ) {
    actionLogText +=
      '\n\n[HINT: Actor prompt is large. Call `const state = await inspectRuntime()` for a compact snapshot of current variables instead of re-reading old outputs.]';
  }

  let actorCallOptions = actorMergedOptions;
  if (s.executorModelPolicy) {
    syncDiscoveredActorModelNamespaces();
    const selectedModel = selectActorModelFromPolicy(
      s.executorModelPolicy,
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
  const actorTurnCallback = rlm.actorTurnCallback;

  const executorResult = await s.actorProgram.forward(
    ai,
    buildActorPromptValues(
      actionLogText,
      guidanceLogText,
      mutableState.runtimeStateSummary,
      summarizedActorLogText,
      contextPressureText
    ),
    actorCallOptions
  );
  if (!debugHideSystemPrompt) {
    mutableState.lastDebugLoggedActorInstruction = actorInstruction;
  }

  // Capture per-turn metadata for the callback.
  const turnUsage = actorTurnCallback
    ? (s.actorProgram.getUsage()?.slice(usageBefore) as
        | AxProgramUsage[]
        | undefined)
    : undefined;
  const turnModel =
    actorCallOptions.model !== undefined
      ? String(actorCallOptions.model)
      : undefined;
  const turnChatLogMessages = actorTurnCallback
    ? snapshotChatLogMessages(s.actorProgram.getChatLog())
    : undefined;

  if (turn === 0) {
    mutableState.restoreNotice = undefined;
  }

  const runtimeCodeFieldName = s.runtimeCodeFieldName ?? 'javascriptCode';
  let code = executorResult[runtimeCodeFieldName] as string | undefined;
  const trimmedCode = code?.trim();
  if (!code || !trimmedCode) {
    return { shouldBreak: true, shouldContinue: false };
  }
  code = normalizeActorCode(trimmedCode);
  executorResult[runtimeCodeFieldName] = code;

  completionState.payload = undefined;
  const functionCallStartIndex = functionCallRecords?.length ?? 0;

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
      appendGuidanceEntry(guidanceState.entries, {
        turn: entryTurn,
        guidance: ACTOR_CODE_POLICY_GUIDANCE,
        triggeredBy: 'runtime policy',
      });
      actionLogEntries.push({
        turn: entryTurn,
        code,
        output: policyViolation,
        tags: ['error'],
        ...(() => {
          const calls =
            functionCallRecords?.slice(functionCallStartIndex) ?? [];
          return calls.length > 0 ? { _functionCalls: calls } : {};
        })(),
      });

      if (actorTurnCallback) {
        await actorTurnCallback({
          stage: contextStage,
          turn: entryTurn,
          actionLogEntryCount: actionLogEntries.length,
          guidanceLogEntryCount: guidanceState.entries.length,
          executorResult: executorResult as Record<string, unknown>,
          code,
          result: undefined,
          output: policyViolation,
          isError: true,
          thought:
            typeof executorResult.thought === 'string'
              ? executorResult.thought
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
        summaryForwardOptions,
        { stage: contextStage, onContextEvent: s.onContextEvent }
      );
      noteActorTurnErrorState(true);
      if (await refreshCheckpointSummary(entryTurn)) {
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
      if (actorTurnCallback) {
        await actorTurnCallback({
          stage: contextStage,
          turn: actionLogEntries.length + 1,
          actionLogEntryCount: actionLogEntries.length,
          guidanceLogEntryCount: guidanceState.entries.length,
          executorResult: executorResult as Record<string, unknown>,
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
            typeof executorResult.thought === 'string'
              ? executorResult.thought
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
    appendGuidanceEntry(guidanceState.entries, {
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
    tags: isError ? ['error'] : [],
    ...(() => {
      const calls = functionCallRecords?.slice(functionCallStartIndex) ?? [];
      return calls.length > 0 ? { _functionCalls: calls } : {};
    })(),
  });

  if (actorTurnCallback) {
    await actorTurnCallback({
      stage: contextStage,
      turn: entryTurn,
      actionLogEntryCount: actionLogEntries.length,
      guidanceLogEntryCount: guidanceState.entries.length,
      executorResult: executorResult as Record<string, unknown>,
      code,
      result,
      output,
      isError,
      thought:
        typeof executorResult.thought === 'string'
          ? executorResult.thought
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
    summaryForwardOptions,
    { stage: contextStage, onContextEvent: s.onContextEvent }
  );
  if (!isError) {
    mutableState.runtimeStateSummary =
      await runtimeContext.captureRuntimeStateSummary();
  }
  noteActorTurnErrorState(isError);
  if (await refreshCheckpointSummary(entryTurn)) {
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
