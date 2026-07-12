/**
 * Live gate for chain-of-evidence citations (`options.citations`).
 *
 * Context-Q&A agent over meeting notes (function-less, so runs take the
 * deterministic respond-only path): the distiller curates the evidence
 * object, and the responder must cite which evidence entries support its
 * answer. Citations are validated in-pipeline (subset of evidence ids;
 * violations re-prompt through the validation-retry loop) — a completed run
 * IS the validity proof, so the gate measures whether models actually cite
 * and whether the extra field costs answer quality.
 *
 * Lanes per model: citations ON vs OFF (control) over the same tasks.
 *
 * Gates:
 *  1. CITE RATE: >= 80% of completed ON runs produce at least one citation.
 *  2. SUBSTANCE PARITY: ON answers keep the nonce substance within 15% of
 *     OFF (the citations field must not degrade answers).
 *  3. NO HARD FAILURES: no ON run dies on validation exhaustion.
 *
 * Run (repo-pinned models):
 *   OPENAI_APIKEY=... EVAL_MODEL=gpt-5.4-mini EVAL_REPEATS=3 \
 *     npx tsx src/examples/agent-citations.ts
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
const repeats = Math.max(1, Number(process.env.EVAL_REPEATS ?? 3) || 3);

if (!openaiKey && !googleKey) {
  console.log(
    'Skipping: set OPENAI_APIKEY and/or GOOGLE_APIKEY (and optionally EVAL_MODEL, EVAL_REPEATS) to run the live citations gate.'
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

const NOTES = [
  '# Platform sync notes (June 3)',
  '',
  'Decision: adopt tiered caching behind flag CACHE-TIER-11 starting July.',
  'Rollout owner: Ingrid; fallback owner: Tomas.',
  '',
  'Incident review: the June 1 outage traced to connection-pool exhaustion',
  '(ticket INC-4482); mitigation was raising the pool ceiling to 512.',
  '',
  'Budget: the vector-store migration is capped at 40k EUR (line BUD-77).',
  'Open question: whether the cap includes the read-replica costs.',
].join('\n');

interface EvalTask {
  id: string;
  query: string;
  substance: RegExp[];
}

const TASKS: EvalTask[] = [
  {
    id: 'decision',
    query: 'What caching decision was made, and behind which flag?',
    substance: [/CACHE-TIER-11/i],
  },
  {
    id: 'incident',
    query:
      'What caused the June 1 outage and what was the mitigation? Include the ticket id.',
    substance: [/INC-4482/i, /pool/i],
  },
  {
    id: 'budget',
    query: 'What is the vector-store migration budget cap and its budget line?',
    substance: [/40k|40,?000/i, /BUD-77/i],
  },
];

type RunResult = {
  taskId: string;
  variant: 'on' | 'off';
  substanceHit: boolean;
  citations: readonly string[];
  failure?: string;
};

async function runOnce(
  llm: ReturnType<typeof ai>,
  task: EvalTask,
  variant: 'on' | 'off'
): Promise<RunResult> {
  let observed: readonly string[] = [];
  const a = agent('notes:string, query:string -> answer:string', {
    ai: llm,
    contextFields: ['notes'],
    ...(variant === 'on'
      ? {
          citations: {
            onCitations: (c: readonly string[]) => {
              observed = c;
            },
          },
        }
      : {}),
    maxTurns: 8,
  });

  try {
    const res = await a.forward(llm, { notes: NOTES, query: task.query });
    const answer = String((res as { answer?: unknown }).answer ?? '');
    return {
      taskId: task.id,
      variant,
      substanceHit: task.substance.every((re) => re.test(answer)),
      citations: observed,
    };
  } catch (err) {
    return {
      taskId: task.id,
      variant,
      substanceHit: false,
      citations: observed,
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

async function runOnceWithRetry(
  llm: ReturnType<typeof ai>,
  task: EvalTask,
  variant: 'on' | 'off'
): Promise<RunResult> {
  const first = await runOnce(llm, task, variant);
  if (first.failure && TRANSIENT.test(first.failure)) {
    console.log(
      `  [retry] ${variant}/${task.id}: ${first.failure.slice(0, 80)}`
    );
    return runOnce(llm, task, variant);
  }
  return first;
}

const pct = (n: number, d: number) =>
  d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(0)}% (${n}/${d})`;

async function runLane(label: string, llm: ReturnType<typeof ai>) {
  const results: RunResult[] = [];
  for (let r = 0; r < repeats; r++) {
    for (const task of TASKS) {
      results.push(await runOnceWithRetry(llm, task, 'on'));
      results.push(await runOnceWithRetry(llm, task, 'off'));
    }
    console.log(`[${label}] repeat ${r + 1}/${repeats} done`);
  }

  const on = results.filter((x) => x.variant === 'on');
  const off = results.filter((x) => x.variant === 'off');
  const onClean = on.filter((x) => !x.failure);
  const cited = onClean.filter((x) => x.citations.length > 0);
  const onSubstance = on.filter((x) => x.substanceHit).length;
  const offSubstance = off.filter((x) => x.substanceHit).length;
  const hardFailures = on.filter((x) => x.failure);

  for (const x of onClean) {
    console.log(
      `  [${label}] on/${x.taskId}: citations=[${x.citations.join(', ')}] substance=${x.substanceHit}`
    );
  }

  const gates = {
    citeRate: onClean.length > 0 && cited.length / onClean.length >= 0.8,
    substanceParity: onSubstance >= offSubstance - Math.ceil(off.length * 0.15),
    noHardFailures: hardFailures.length === 0,
  };

  console.log(`\n=== ${label} ===`);
  console.log(
    `cite rate: ${pct(cited.length, onClean.length)}  substance on: ${pct(onSubstance, on.length)}  off: ${pct(offSubstance, off.length)}  hard failures: ${hardFailures.length}`
  );
  console.log(
    `gates          cite-rate>=80%: ${gates.citeRate ? 'PASS' : 'FAIL'}  ` +
      `substance-parity(on>=off-15%): ${gates.substanceParity ? 'PASS' : 'FAIL'}  ` +
      `no-hard-failures: ${gates.noHardFailures ? 'PASS' : 'FAIL'}`
  );
  for (const x of hardFailures) {
    console.log(`  HARD FAILURE: ${x.taskId}: ${x.failure}`);
  }
  return gates.citeRate && gates.substanceParity && gates.noHardFailures;
}

let allPass = true;
for (const lane of lanes) {
  allPass = (await runLane(lane.label, lane.llm)) && allPass;
}
console.log(`\nCITATIONS GATE: ${allPass ? 'PASS' : 'FAIL'}`);
process.exit(allPass ? 0 : 1);
