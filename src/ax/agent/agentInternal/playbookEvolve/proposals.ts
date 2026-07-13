/**
 * Bounded proposal application for `agent.playbook().evolve()`.
 *
 * One surface: a curated playbook update. Rollback restores the pre-apply
 * snapshot via `load()`. (Verified learning produces only playbook bullets;
 * the standing-instruction surface lives on `agent.setInstruction()` /
 * `addActorInstruction()`, not here.)
 */

import { axPlaybookFailureSection } from '../failureReport.js';
import type {
  AxAgentPlaybookEvolveProposal,
  AxAgentPlaybookWeakness,
} from './playbookEvolveTypes.js';

export type AxAppliedProposal = {
  proposal: AxAgentPlaybookEvolveProposal;
  rollback: () => void;
};

/** The playbook text currently applied to the agent, fed to the miner. */
export function currentPlaybookText(agent: any): string | undefined {
  const rendered = agent.getPlaybook?.()?.render?.();
  return typeof rendered === 'string' && rendered.trim().length > 0
    ? rendered
    : undefined;
}

export function buildProposal(
  weakness: AxAgentPlaybookWeakness
): AxAgentPlaybookEvolveProposal {
  const quotes = weakness.evidenceQuotes
    .slice(0, 3)
    .map((quote) => `- ${quote}`)
    .join('\n');
  return {
    weaknessId: weakness.id,
    clusterSignature: weakness.clusterSignature,
    feedback: `A recurring agent weakness was diagnosed from real failed runs.

Weakness: ${weakness.description}
Root cause: ${weakness.rootCause}
Error signature: [${weakness.clusterSignature}]
Grounding excerpts:
${quotes}

Curate ONE durable rule into the playbook (suggested section: "${axPlaybookFailureSection}"): ${weakness.proposedGuidance}
UPDATE an existing bullet if one already covers this failure mode.`,
  };
}

/**
 * Apply a proposal to the live playbook and return its exact rollback. The
 * weakness signature is recorded on the update event so the run-end dedupe
 * ledger (`collectCoveredFailureSignatures`) stays coherent with
 * evolve()-curated lessons.
 */
export async function applyProposal(args: {
  proposal: AxAgentPlaybookEvolveProposal;
  playbookHandle: any;
}): Promise<AxAppliedProposal> {
  const { proposal, playbookHandle: handle } = args;
  if (!handle) {
    throw new Error(
      'AxAgent.playbook().evolve(): no playbook handle available.'
    );
  }
  const snapshot = handle.getState();
  await handle.update({
    example: {
      task: 'playbook.evolve(): repair a diagnosed agent weakness',
      failureSignatures: [proposal.clusterSignature],
    },
    prediction: {},
    feedback: proposal.feedback,
  });
  return {
    proposal,
    rollback: () => {
      handle.load(snapshot);
    },
  };
}
