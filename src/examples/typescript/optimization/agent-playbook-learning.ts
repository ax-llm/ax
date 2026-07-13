// ax-example:start
// title: TypeScript Agent Playbook — Learn From Failures
// group: optimization
// description: An agent that learns from its own failed runs — the playbook config harvests each run's errors into avoidance rules that ride the next run.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 40
// ax-example:end
import {
  type AxAgentPlaybookUpdateResult,
  AxAIOpenAIModel,
  agent,
  ai,
} from '@ax-llm/ax';

const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY;
if (!apiKey) {
  throw new Error('Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.');
}

const llm = ai({
  name: 'openai',
  apiKey,
  config: { model: AxAIOpenAIModel.GPT54Mini },
});

// A ledger tool that quietly REQUIRES the "LGR-" id prefix. Neither the tool
// description nor the task reveals it — only the rejection error teaches it.
const ledger = {
  'LGR-4471': 'balance 812.55 EUR (ref TXN-CC12)',
  'LGR-8290': 'balance 4210.09 EUR (ref TXN-KD73)',
} as Record<string, string>;

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
    return { id, entry: ledger[id] ?? 'no such entry' };
  },
};

// Attach a playbook at construction. `learn` is on by default: after each run
// that produced failure signals, one bounded update curates an avoidance rule.
let learned: AxAgentPlaybookUpdateResult | undefined;
const support = agent('query:string -> answer:string', {
  ai: llm,
  functions: [lookupLedgerEntry],
  playbook: {
    onUpdate: (r) => {
      learned = r;
    },
  },
  maxTurns: 8,
});

// Run A: the agent trips the id-format trap, recovers in-run, and the
// run-end harvest curates a "don't do that" rule into the playbook.
const a = await support.forward(llm, {
  query:
    'Look up ledger entry 4471 and report its balance with the transaction ref.',
});
console.log('Run A answer:', a.answer);
console.log('\nHarvested playbook after run A:\n');
console.log(support.getPlaybook()?.render() ?? '(none)');
console.log('\nonUpdate status:', learned?.status);

// Run B on the SAME agent. forward() keeps no memory of run A's turns — the
// only thing that carries over is the curated playbook, now riding the actor
// prompt. So the agent uses the "LGR-" prefix on the first try (no failing
// tool call) purely because of the harvested rule.
const b = await support.forward(llm, {
  query:
    'Look up ledger entry 4471 and report its balance with the transaction ref.',
});
console.log('\nRun B answer:', b.answer);

// Persist the learned playbook for a future session with support.getPlaybook().getState().
