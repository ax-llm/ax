import type { AxAgentExecutorResultPayload } from './agentInternalTypes.js';

/**
 * Reshape an upstream actor's `{type, args}` envelope into the `{task, evidence}`
 * payload every synthesis stage's `contextData` input expects. Every call site
 * either throws on `askClarification` upstream or only invokes the synthesizer
 * when the actor terminated with `final(...)`, so `args[0]` is the task
 * instruction and `args[1]` is the curated evidence (which may be absent for
 * synthetic finals — the responder template tolerates that).
 */
export function buildResponderContextData(
  executorResult: AxAgentExecutorResultPayload
): { task: unknown; evidence: unknown } {
  return {
    task: executorResult.args[0],
    evidence: executorResult.args[1],
  };
}
