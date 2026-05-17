import type {
  ActionLogEntry,
  CheckpointSummaryState,
} from '../contextManager.js';
import type { buildActorLoopSetup } from './actorLoopSetup.js';
import type {
  AxAgentContextStage,
  AxAgentEvalFunctionCall,
  AxAgentGuidanceState,
  AxAgentRuntimeCompletionState,
  AxAgentStateExecutorModelState,
  AxAgentUsedMemory,
  AxAgentUsedSkill,
} from './types.js';

export interface MutableActorLoopState {
  checkpointState: CheckpointSummaryState | undefined;
  actorModelState: AxAgentStateExecutorModelState | undefined;
  restoreNotice: string | undefined;
  runtimeStateSummary: string | undefined;
  lastDebugLoggedActorInstruction: string | undefined;
  actorFieldValues: Record<string, unknown>;
  usedMemories: AxAgentUsedMemory[];
  usedSkills: AxAgentUsedSkill[];
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
  contextStage: AxAgentContextStage;
  contextThreshold: any;
  delegatedContextSummary: any;
  mutableState: MutableActorLoopState;
  helpers: ReturnType<typeof buildActorLoopSetup>;
}
