/**
 * Live gate for construction-time playbook failure learning
 * (`options.playbook` + run-end failure harvest into curated playbook rules).
 *
 * Scenario: a ledger tool silently requires the "LGR-" id prefix while the
 * task and context only mention bare entry numbers — a deterministic
 * argument trap. Per repeat:
 *
 *  - learned lane: an agent with a `playbook` config runs task A (trap
 *    fires, run-end harvest curates an avoidance rule, `onUpdate` hands out
 *    the snapshot), then a FRESH agent seeded with that snapshot runs task B
 *    — isolating the persisted playbook's value from same-session memory.
 *  - control lane: a fresh agent (no playbook) runs task B cold.
 *
 * Gates:
 *  1. HARVEST (hard): every task-A run that hit the trap fires `onUpdate`
 *     with an updated snapshot whose bullets mention the LGR format.
 *  2. AVOIDANCE: learned-lane task-B trap hits are zero, or strictly fewer
 *     than the control lane's.
 *  3. SUBSTANCE: task-B answers keep the tool nonce in both lanes (the
 *     playbook must not degrade task completion).
 *
 * Run (repo-pinned models):
 *   OPENAI_APIKEY=... EVAL_MODEL=gpt-5.4-mini EVAL_REPEATS=3 \
 *     npx tsx src/examples/agent-failure-learning.ts
 *   Add GOOGLE_APIKEY=... to also run the gemini-3.5-flash lane.
 */
import {
  type AxAgentPlaybookUpdateResult,
  type AxAIGoogleGeminiModel,
  type AxAIOpenAIModel,
  agent,
  ai,
} from '@ax-llm/ax';

const openaiKey = process.env.OPENAI_APIKEY;
const googleKey = process.env.GOOGLE_APIKEY;
const openaiModel = process.env.EVAL_MODEL ?? 'gpt-5.4-mini';
const googleModel = process.env.EVAL_GOOGLE_MODEL ?? 'gemini-3.5-flash';
const repeats = Math.max(1, Number(process.env.EVAL_REPEATS ?? 3) || 3);

if (!openaiKey && !googleKey) {
  console.log(
    'Skipping: set OPENAI_APIKEY and/or GOOGLE_APIKEY (and optionally EVAL_MODEL, EVAL_REPEATS) to run the live failure-learning gate.'
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
  'LGR-8290': 'balance 4210.09 EUR (ref TXN-KD73)',
};

/**
 * The trap: ids must use the LGR- prefix, but neither the tool description
 * nor the tasks reveal that — only the rejection error teaches it.
 */
function buildLedgerTool(counter: { rejects: number; attempts: number }) {
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
      counter.attempts++;
      if (!/^LGR-\d{4}$/.test(id)) {
        counter.rejects++;
        throw new Error(
          `InvalidLedgerIdError: ledger entry ids use the "LGR-" prefix followed by 4 digits (got "${id}"); retry with e.g. "LGR-4471"`
        );
      }
      return { id, entry: LEDGER[id] ?? 'no such entry' };
    },
  };
}

const TASK_A =
  'Look up ledger entry 4471 and report its balance with the transaction ref.';
const TASK_B =
  'Look up ledger entry 8290 and report its balance with the transaction ref.';
const SUBSTANCE_B = /TXN-KD73/i;

type RepeatResult = {
  trapHitsA: number;
  harvested: boolean;
  bulletMentionsFormat: boolean;
  updateStatuses: string[];
  trapHitsBLearned: number;
  attemptsBLearned: number;
  trapHitsBControl: number;
  substanceLearned: boolean;
  substanceControl: boolean;
  failure?: string;
};

async function runRepeat(llm: ReturnType<typeof ai>): Promise<RepeatResult> {
  const counterA = { rejects: 0, attempts: 0 };
  const counterBLearned = { rejects: 0, attempts: 0 };
  const counterBControl = { rejects: 0, attempts: 0 };
  const updates: AxAgentPlaybookUpdateResult[] = [];

  const harvester = agent('query:string -> answer:string', {
    ai: llm,
    functions: [buildLedgerTool(counterA)],
    playbook: { onUpdate: (result) => void updates.push(result) },
    maxTurns: 8,
  });

  try {
    await harvester.forward(llm, { query: TASK_A });
    const trapHitsA = counterA.rejects;

    const snapshot = updates.at(-1)?.snapshot;
    const allBullets = Object.values(snapshot?.playbook.sections ?? {}).flat();

    // Task B on a FRESH agent seeded with the persisted snapshot — the only
    // carry-over from task A is the playbook itself.
    const seeded = agent('query:string -> answer:string', {
      ai: llm,
      functions: [buildLedgerTool(counterBLearned)],
      ...(snapshot ? { playbook: { playbook: snapshot, learn: false } } : {}),
      maxTurns: 8,
    });
    const resLearned = await seeded.forward(llm, { query: TASK_B });

    const control = agent('query:string -> answer:string', {
      ai: llm,
      functions: [buildLedgerTool(counterBControl)],
      maxTurns: 8,
    });
    const resControl = await control.forward(llm, { query: TASK_B });

    return {
      trapHitsA,
      harvested:
        updates.some((u) => u.status === 'updated') && allBullets.length > 0,
      bulletMentionsFormat: allBullets.some((b) => /LGR/i.test(b.content)),
      updateStatuses: updates.map((u) => u.status),
      trapHitsBLearned: counterBLearned.rejects,
      attemptsBLearned: counterBLearned.attempts,
      trapHitsBControl: counterBControl.rejects,
      substanceLearned: SUBSTANCE_B.test(
        String((resLearned as { answer?: unknown }).answer ?? '')
      ),
      substanceControl: SUBSTANCE_B.test(
        String((resControl as { answer?: unknown }).answer ?? '')
      ),
    };
  } catch (err) {
    return {
      trapHitsA: counterA.rejects,
      harvested: false,
      bulletMentionsFormat: false,
      updateStatuses: updates.map((u) => u.status),
      trapHitsBLearned: counterBLearned.rejects,
      attemptsBLearned: counterBLearned.attempts,
      trapHitsBControl: counterBControl.rejects,
      substanceLearned: false,
      substanceControl: false,
      failure: String(err).slice(0, 140),
    };
  }
}

// Live-network harness hardening: a provider blip must not kill the gate run.
process.on('unhandledRejection', (err) => {
  console.log(`  [warn] unhandled rejection: ${String(err).slice(0, 140)}`);
});

const TRANSIENT =
  /ETIMEDOUT|ECONNRESET|ECONNREFUSED|fetch failed|network|terminated|529|overloaded/i;

async function runLane(label: string, llm: ReturnType<typeof ai>) {
  const results: RepeatResult[] = [];
  for (let r = 0; r < repeats; r++) {
    let result = await runRepeat(llm);
    if (result.failure && TRANSIENT.test(result.failure)) {
      console.log(`  [retry] repeat ${r + 1}: ${result.failure.slice(0, 80)}`);
      result = await runRepeat(llm);
    }
    results.push(result);
    console.log(
      `[${label}] repeat ${r + 1}/${repeats}: trapA=${result.trapHitsA} harvested=${result.harvested} ` +
        `bulletLGR=${result.bulletMentionsFormat} updates=[${result.updateStatuses.join(',')}] ` +
        `trapB learned=${result.trapHitsBLearned}/${result.attemptsBLearned}att control=${result.trapHitsBControl} ` +
        `subst learned=${result.substanceLearned} control=${result.substanceControl}` +
        (result.failure ? ` FAILURE=${result.failure}` : '')
    );
  }

  const clean = results.filter((x) => !x.failure);
  const trapped = clean.filter((x) => x.trapHitsA > 0);
  const failures = results.filter((x) => x.failure);
  const learnedB = trapped.reduce((n, x) => n + x.trapHitsBLearned, 0);
  const controlB = trapped.reduce((n, x) => n + x.trapHitsBControl, 0);
  const harvestHits = trapped.filter(
    (x) => x.harvested && x.bulletMentionsFormat
  );
  const substLearned = clean.filter((x) => x.substanceLearned).length;
  const substControl = clean.filter((x) => x.substanceControl).length;

  // Majority/parity gates: the curator and the answers ride live models, so
  // single-repeat noise must not flip the gate.
  const gates = {
    harvest: trapped.length === 0 || harvestHits.length * 2 > trapped.length,
    avoidance: trapped.length === 0 || learnedB === 0 || learnedB < controlB,
    substanceParity: substLearned >= substControl - 1,
  };

  console.log(`\n=== ${label} ===`);
  console.log(
    `repeats: ${results.length}  trapped-on-A: ${trapped.length}  run-failures: ${failures.length}`
  );
  console.log(
    `harvest hits: ${harvestHits.length}/${trapped.length}  task-B trap hits learned: ${learnedB} control: ${controlB}  ` +
      `substance learned: ${substLearned}/${clean.length} control: ${substControl}/${clean.length}`
  );
  if (trapped.length === 0) {
    console.log(
      '  note: the model never hit the trap on task A — nothing to learn; harvest/avoidance gates pass vacuously.'
    );
  }
  console.log(
    `gates          harvest(majority of trapped): ${gates.harvest ? 'PASS' : 'FAIL'}  ` +
      `avoidance(learned<control or 0): ${gates.avoidance ? 'PASS' : 'FAIL'}  ` +
      `substance-parity(learned>=control-1): ${gates.substanceParity ? 'PASS' : 'FAIL'}`
  );
  for (const x of failures) {
    console.log(`  RUN FAILURE: ${x.failure}`);
  }
  return gates.harvest && gates.avoidance && gates.substanceParity;
}

let allPass = true;
for (const lane of lanes) {
  allPass = (await runLane(lane.label, lane.llm)) && allPass;
}
console.log(`\nFAILURE-LEARNING GATE: ${allPass ? 'PASS' : 'FAIL'}`);
process.exit(allPass ? 0 : 1);
