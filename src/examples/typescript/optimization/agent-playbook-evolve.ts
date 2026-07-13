// ax-example:start
// title: TypeScript Agent Playbook — Verified Evolve
// group: optimization
// description: Repair a failing agent from a task set with playbook().evolve — mine failures, propose a bullet, keep it ONLY if it provably helps without regressing a held-out set.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 41
// ax-example:end
import { AxAIOpenAIModel, type AxMetricFn, agent, ai } from '@ax-llm/ax';

const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY;
if (!apiKey) {
  throw new Error('Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.');
}

const llm = ai({
  name: 'openai',
  apiKey,
  config: { model: AxAIOpenAIModel.GPT54Mini },
});

const LEDGER: Record<string, string> = {
  'LGR-4471': 'balance 812.55 EUR (ref TXN-CC12)',
  'LGR-9130': 'balance 77.10 EUR (ref TXN-QP55)',
  'LGR-8290': 'balance 4210.09 EUR (ref TXN-KD73)',
};

// Same "LGR-" id-format trap: the agent recovers in-run but wastes a failing
// tool call each time — something a curated playbook rule can fix.
const lookupLedgerEntry = {
  name: 'lookupLedgerEntry',
  description: 'Look up a ledger entry by its id and return the balance',
  parameters: {
    type: 'object' as const,
    properties: {
      id: { type: 'string' as const, description: 'Ledger entry id' },
    },
    required: ['id'],
  },
  func: async ({ id }: { id: string }) => {
    if (!/^LGR-\d{4}$/.test(id)) {
      throw new Error(
        `InvalidLedgerIdError: ledger entry ids use the "LGR-" prefix followed by 4 digits (got "${id}"); retry with e.g. "LGR-4471"`
      );
    }
    return { id, entry: LEDGER[id] ?? 'no such entry' };
  },
};

const support = agent('query:string -> answer:string', {
  ai: llm,
  functions: [lookupLedgerEntry],
  maxTurns: 8,
});

// A deterministic scorer: correct answer with NO wasted failing tool call = 1;
// correct answer that tripped the trap = 0.4; wrong answer = 0.
const task = (entry: string, nonce: string, id: string) => ({
  id,
  input: {
    query: `Look up ledger entry ${entry} and report its balance with the transaction ref.`,
  },
  criteria: 'Reports the correct balance and transaction ref.',
  metadata: { nonce },
});
const metric: AxMetricFn = ({ example, prediction }) => {
  const nonce =
    (example as { metadata?: { nonce?: string } }).metadata?.nonce ?? '';
  const answer = String(
    (prediction as { output?: { answer?: unknown } }).output?.answer ?? ''
  );
  if (!answer.toLowerCase().includes(nonce.toLowerCase())) return 0;
  return ((prediction as { toolErrors?: unknown[] }).toolErrors?.length ??
    0) === 0
    ? 1
    : 0.4;
};

// Verified evolve: mine the failing train tasks, propose a playbook bullet,
// and keep it ONLY if train improves AND the held-out task doesn't regress.
const result = await support.playbook().evolve(
  {
    train: [
      task('4471', 'TXN-CC12', 'train-4471'),
      task('9130', 'TXN-QP55', 'train-9130'),
    ],
    validation: [task('8290', 'TXN-KD73', 'holdout-8290')],
  },
  { metric, maxProposals: 2, runsPerTask: 2, verbose: true }
);

console.log(
  `\nbaseline held-in ${result.baseline.heldIn.toFixed(2)} / held-out ${result.baseline.heldOut?.toFixed(2)}`
);
console.log(
  `final    held-in ${result.final.heldIn.toFixed(2)} / held-out ${result.final.heldOut?.toFixed(2)}  (${result.metricCallsUsed} eval calls)`
);
for (const w of result.weaknesses) {
  console.log(`\nweakness: ${w.description}`);
}
for (const o of result.outcomes) {
  console.log(`proposal ${o.accepted ? 'ACCEPTED' : 'rejected'} — ${o.reason}`);
}
console.log('\nlearned playbook:\n');
console.log(support.getPlaybook()?.render() ?? '(none)');
