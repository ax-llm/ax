/**
 * Bounded proposal application for `agent.improve()`.
 *
 * Exactly two surfaces, both with exact rollback:
 *  - `playbook`: one curated update on the agent's playbook handle; rollback
 *    restores the pre-apply snapshot via `load()`.
 *  - `instructions`: a standing addendum pushed onto the executor stage's
 *    `instructionAddenda` channel — additive by construction, so it cannot
 *    clobber (or be clobbered by) the playbook apply-hook, which recomposes
 *    `executorDescription` from a base captured at handle creation. Never
 *    `actor-tpl` (template overrides carry placeholder constraints and churn
 *    the whole prompt).
 */

import { axPlaybookFailureSection } from '../failureReport.js';
import type {
  AxAgentImproveProposal,
  AxAgentWeakness,
} from './improveTypes.js';

export type AxAppliedProposal = {
  proposal: AxAgentImproveProposal;
  rollback: () => void;
};

/**
 * Current standing instruction text steering the executor actor — the same
 * three channels the actor definition composes: the optimizable
 * `stageInstruction`, the user/playbook `executorDescription`, and any
 * `instructionAddenda`. Fed to the miner so it never proposes an addendum
 * that duplicates or contradicts what already steers the agent.
 */
export function actorInstructionText(agent: any): string | undefined {
  const stage: any = agent.executor;
  const parts = [
    stage?.stageInstruction,
    stage?.executorDescription,
    ...((stage?.instructionAddenda as string[] | undefined) ?? []),
  ].filter(
    (part: unknown): part is string =>
      typeof part === 'string' && part.trim().length > 0
  );
  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

export function buildProposal(
  weakness: AxAgentWeakness
): AxAgentImproveProposal {
  if (weakness.surface === 'instructions') {
    return {
      kind: 'instructions',
      weaknessId: weakness.id,
      addendum: weakness.proposedGuidance.trim(),
    };
  }
  const quotes = weakness.evidenceQuotes
    .slice(0, 3)
    .map((quote) => `- ${quote}`)
    .join('\n');
  return {
    kind: 'playbook',
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
 * Apply a proposal to the live agent and return its exact rollback. The
 * playbook path records the weakness signature on the update event so P1's
 * run-end dedupe ledger stays coherent with improve()-curated lessons.
 */
export async function applyProposal(args: {
  agent: any;
  proposal: AxAgentImproveProposal;
  playbookHandle?: any;
}): Promise<AxAppliedProposal> {
  const { agent, proposal } = args;
  if (proposal.kind === 'playbook') {
    const handle = args.playbookHandle;
    if (!handle) {
      throw new Error(
        'AxAgent.improve(): no playbook handle available for a playbook proposal.'
      );
    }
    const snapshot = handle.getState();
    await handle.update({
      example: {
        task: 'improve(): repair a diagnosed agent weakness',
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

  agent.addActorInstruction(proposal.addendum);
  const needle = proposal.addendum.trim();
  return {
    proposal,
    rollback: () => {
      const stage: any = agent.executor;
      const addenda = stage?.instructionAddenda as string[] | undefined;
      const index = addenda?.lastIndexOf(needle) ?? -1;
      if (addenda && index >= 0) {
        addenda.splice(index, 1);
        stage._buildSplitPrograms?.();
      }
    },
  };
}
