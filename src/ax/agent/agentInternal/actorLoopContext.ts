import type {
  ActionLogEntry,
  CheckpointSummaryState,
} from '../contextManager.js';
import type { buildActorLoopSetup } from './actorLoopSetup.js';
import type {
  AxAgentEvalFunctionCall,
  AxAgentGuidanceState,
  AxAgentRuntimeCompletionState,
  AxAgentStateExecutorModelState,
} from './types.js';

export interface MutableActorLoopState {
  checkpointState: CheckpointSummaryState | undefined;
  actorModelState: AxAgentStateExecutorModelState | undefined;
  restoreNotice: string | undefined;
  runtimeStateSummary: string | undefined;
  lastDebugLoggedActorInstruction: string | undefined;
  actorFieldValues: Record<string, unknown>;
}

export interface ActorLoopContext {
  s: any;
  ai: any;
  rlm: any;
  runtimeContext: any;
  inputState: any;
  completionState: AxAgentRuntimeCompletionState;
  guidanceState: AxAgentGuidanceState;
  actionLogEntries: ActionLogEntry[];
  actorMergedOptions: any;
  summaryForwardOptions: any;
  functionCallRecords?: AxAgentEvalFunctionCall[];
  explicitActorDebugHideSystemPrompt: boolean | undefined;
  contextThreshold: any;
  delegatedContextSummary: any;
  mutableState: MutableActorLoopState;
  helpers: ReturnType<typeof buildActorLoopSetup>;
}
