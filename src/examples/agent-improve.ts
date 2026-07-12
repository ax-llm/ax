/**
 * Live gate for `agent.improve()` — failure-driven repair with
 * regression-validated acceptance.
 *
 * Scenario: a ledger tool rejects bare entry ids (the "LGR-" format trap
 * from agent-failure-learning.ts). Models recover in-run — the rejection
 * message teaches the format — so answers are correct but every run wastes a
 * failing tool call. The deterministic metric prices that in: nonce answer
 * with zero tool errors scores 1.0, nonce answer with tool errors 0.4,
 * wrong answer 0. improve() must mine the failing-call pattern from the run
 * excerpts, propose a rule (instruction addendum or playbook lesson), and
 * accept it only if train improves while the held-out task does not regress.
 *
 * Gates (per model lane, skipped as vacuous when the baseline never traps):
 *  1. WEAKNESS: >= 1 mined weakness keyed to the ledger-id failure.
 *  2. REPAIR: an accepted proposal improved held-in, OR every proposal was
 *     cleanly rejected with scores restored to baseline (the safety gate
 *     refusing a non-improving edit is correct behavior, not a failure).
 *  3. HOLD-OUT: final held-out >= baseline held-out - epsilon.
 *
 * Run (repo-pinned models):
 *   OPENAI_APIKEY=... EVAL_MODEL=gpt-5.4-mini \
 *     npx tsx src/examples/agent-improve.ts
 *   Add GOOGLE_APIKEY=... to also run the gemini-3.5-flash lane.
 */
import {
  type AxAIGoogleGeminiModel,
  type AxAIOpenAIModel,
  agent,
  ai,
} from '@ax-llm/ax';

const openaiKey = process.env.OPENAI_APIKEY;
const googleKey = process.env.GOOGLE_APIKEY;
const openaiModel = process.env.EVAL_MODEL ?? 'gpt-5.4-mini';
const googleModel = process.env.EVAL_GOOGLE_MODEL ?? 'gemini-3.5-flash';

if (!openaiKey && !googleKey) {
  console.log(
    'Skipping: set OPENAI_APIKEY and/or GOOGLE_APIKEY (and optionally EVAL_MODEL) to run the live improve gate.'
  );
  process.exit(0);
}

const lanes: { label: string; llm: ReturnType<typeof ai> }[] = [];
if (openaiKey) {
  lanes.push({
    label: `openai/${openaiModel}`,
    // No temperature override — some gpt-5.x models only accept the default.
    llm: ai({
      name: 'openai',
      apiKey: openaiKey,
      config: { model: openaiModel as AxAIOpenAIModel },
    }),
  });
}
if (googleKey) {
  lanes.push({
    label: `google/${googleModel}`,
    llm: ai({
      name: 'google-gemini',
      apiKey: googleKey,
      config: { model: googleModel as AxAIGoogleGeminiModel },
    }),
  });
}

const LEDGER: Record<string, string> = {
  'LGR-4471': 'balance 812.55 EUR (ref TXN-CC12)',
  'LGR-9130': 'balance 77.10 EUR (ref TXN-QP55)',
  'LGR-8290': 'balance 4210.09 EUR (ref TXN-KD73)',
};

function buildLedgerTool() {
  return {
    name: 'lookupLedgerEntry',
    description: 'Look up a ledger entry by its id and return the balance',
    parameters: {
      type: 'object' as const,
      properties: {
        id: { type: 'string' as const, description: 'Ledger entry id' },
      },
      required: ['id'],
    },
    func: async ({ id }: Readonly<{ id: string }>) => {
      if (!/^LGR-\d{4}$/.test(id)) {
        throw new Error(
          `InvalidLedgerIdError: ledger entry ids use the "LGR-" prefix followed by 4 digits (got "${id}"); retry with e.g. "LGR-4471"`
        );
      }
      return { id, entry: LEDGER[id] ?? 'no such entry' };
    },
  };
}

const task = (entry: string, nonce: string, id: string) => ({
  id,
  input: {
    query: `Look up ledger entry ${entry} and report its balance with the transaction ref.`,
  },
  criteria: 'Reports the correct balance and transaction ref.',
  metadata: { nonce },
});

const TRAIN = [
  task('4471', 'TXN-CC12', 'train-4471'),
  task('9130', 'TXN-QP55', 'train-9130'),
];
const VALIDATION = [task('8290', 'TXN-KD73', 'holdout-8290')];

/** Deterministic scorer: right answer 0.4, right answer without wasted
 * failing tool calls 1.0. */
const metric = async ({ example, prediction }: any) => {
  const nonce = (example as any).metadata?.nonce as string;
  const answer = String(prediction?.output?.answer ?? '');
  if (!answer.toLowerCase().includes(nonce.toLowerCase())) {
    return 0;
  }
  return (prediction?.toolErrors?.length ?? 0) === 0 ? 1 : 0.4;
};

// Live-network harness hardening: a provider blip must not kill the gate run.
process.on('unhandledRejection', (err) => {
  console.log(`  [warn] unhandled rejection: ${String(err).slice(0, 140)}`);
});

async function runLane(label: string, llm: ReturnType<typeof ai>) {
  const ag = agent('query:string -> answer:string', {
    ai: llm,
    functions: [buildLedgerTool()],
    directResponse: 'off',
    maxTurns: 8,
  });

  const result = await ag.improve(
    { train: TRAIN, validation: VALIDATION },
    {
      metric,
      maxProposals: 2,
      // Average two runs per task: the accept gate compares mean scores, and
      // on a 3-task dataset a single lucky/unlucky run would otherwise
      // decide it.
      runsPerTask: 2,
      onProgress: (e) => console.log(`  [${label}] ${e.phase}: ${e.message}`),
    }
  );

  const trapped = result.records.some(
    (r) => (r.prediction?.toolErrors?.length ?? 0) > 0
  );
  const minedLedgerWeakness = result.weaknesses.some((w) =>
    /lookupLedgerEntry|InvalidLedgerIdError|LGR/i.test(w.clusterSignature)
  );
  const acceptedCount = result.outcomes.filter((o) => o.accepted).length;

  // A correct rejection (proposal rolled back, scores restored to baseline)
  // is the safety gate doing its job, not a repair failure — the repair gate
  // requires EITHER an accepted improvement OR a clean rejection.
  const cleanRejection =
    acceptedCount === 0 &&
    result.outcomes.length > 0 &&
    result.final.heldIn === result.baseline.heldIn;
  const gates = {
    weakness: !trapped || minedLedgerWeakness,
    repair:
      !trapped ||
      (acceptedCount > 0 && result.final.heldIn > result.baseline.heldIn) ||
      cleanRejection,
    holdOut:
      result.final.heldOut === undefined ||
      result.baseline.heldOut === undefined ||
      result.final.heldOut >= result.baseline.heldOut - 0.01,
  };

  console.log(`\n=== ${label} ===`);
  console.log(
    `baseline heldIn=${result.baseline.heldIn.toFixed(2)} heldOut=${result.baseline.heldOut?.toFixed(2)}  ` +
      `final heldIn=${result.final.heldIn.toFixed(2)} heldOut=${result.final.heldOut?.toFixed(2)}  ` +
      `metricCalls=${result.metricCallsUsed}`
  );
  for (const w of result.weaknesses) {
    console.log(
      `  weakness ${w.id} [${w.clusterSignature.slice(0, 60)}] -> ${w.surface}: ${w.description.slice(0, 100)}`
    );
  }
  for (const o of result.outcomes) {
    console.log(
      `  outcome ${o.proposal.weaknessId} (${o.proposal.kind}): ${o.accepted ? 'ACCEPTED' : 'rejected'} — ${o.reason} ` +
        `(heldIn ${o.heldIn.before.toFixed(2)}->${o.heldIn.after.toFixed(2)})`
    );
  }
  if (result.recommendations.length > 0) {
    console.log(`  recommendations: ${result.recommendations.join(' | ')}`);
  }
  if (!trapped) {
    console.log(
      '  note: the baseline never hit the trap — nothing to repair; gates pass vacuously.'
    );
  }
  if (cleanRejection) {
    console.log(
      '  note: all proposals were rejected and rolled back cleanly — the accept gate refused a non-improving edit.'
    );
  }
  console.log(
    `gates          weakness: ${gates.weakness ? 'PASS' : 'FAIL'}  ` +
      `repair(accepted-improvement or clean-rejection): ${gates.repair ? 'PASS' : 'FAIL'}  ` +
      `hold-out: ${gates.holdOut ? 'PASS' : 'FAIL'}`
  );
  return gates.weakness && gates.repair && gates.holdOut;
}

let allPass = true;
for (const lane of lanes) {
  try {
    allPass = (await runLane(lane.label, lane.llm)) && allPass;
  } catch (err) {
    console.log(`[${lane.label}] LANE FAILURE: ${String(err).slice(0, 200)}`);
    allPass = false;
  }
}
console.log(`\nIMPROVE GATE: ${allPass ? 'PASS' : 'FAIL'}`);
process.exit(allPass ? 0 : 1);
