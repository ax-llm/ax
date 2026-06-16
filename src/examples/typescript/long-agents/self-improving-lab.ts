// ax-example:start
// title: TypeScript Self-Improving Lab Agent
// group: long-agents
// description: A many-tool agent that runs experiments, grades them against a rubric with an independent verifier, and distills verified rules into memory — iterating until the rubric passes.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 40
// ax-example:end
import { AxAIOpenAIModel, AxJSRuntime, agent, ai, ax, f, fn } from '@ax-llm/ax';

const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY;
if (!apiKey) {
  throw new Error('Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.');
}

const llm = ai({
  name: 'openai',
  apiKey,
  config: {
    model: AxAIOpenAIModel.GPT4OMini,
    temperature: 0,
  },
});

// ---------------------------------------------------------------------------
// The "lab": a deterministic black-box experiment. It scores an ETL config plan
// against a hidden ideal by checking how many data-quality checks it satisfies.
// The agent must discover the right flags by experimenting, not by being told.
// ---------------------------------------------------------------------------
const CHECKS = [
  'no-nulls',
  'no-duplicates',
  'numeric-types',
  'trimmed-strings',
  'outliers-handled',
];

// What it takes to satisfy each check. A real harness gives actionable feedback;
// this one returns the exact fix for any failing check so the agent can converge.
const REMEDIES: Record<string, string> = {
  'no-nulls': 'set nullPolicy=impute (or nullPolicy=drop)',
  'no-duplicates': 'set dedup=on',
  'numeric-types': 'set coerceTypes=on',
  'trimmed-strings': 'set trim=on',
  'outliers-handled': 'set outlier=clip (or outlier=winsorize)',
};

function runInSandbox(plan: string) {
  const flags: Record<string, string> = {};
  for (const m of plan.toLowerCase().matchAll(/([a-z]+)\s*=\s*([a-z0-9]+)/g)) {
    flags[m[1]] = m[2];
  }
  const ok: Record<string, boolean> = {
    'no-nulls': flags.nullpolicy === 'impute' || flags.nullpolicy === 'drop',
    'no-duplicates': flags.dedup === 'on',
    'numeric-types': flags.coercetypes === 'on',
    'trimmed-strings': flags.trim === 'on',
    'outliers-handled':
      flags.outlier === 'clip' || flags.outlier === 'winsorize',
  };
  const passed = CHECKS.filter((c) => ok[c]);
  const failed = CHECKS.filter((c) => !ok[c]).map((c) => ({
    check: c,
    fix: REMEDIES[c],
  }));
  const score = +(passed.length / CHECKS.length).toFixed(2);
  return {
    score,
    solved: passed.length === CHECKS.length,
    passed,
    failed,
    logs: `${passed.length}/${CHECKS.length} checks passed`,
  };
}

// An independent verifier — a separate ax() program, not the agent grading itself.
const verifier = ax(
  'rubric:string, evidence:json -> passed:boolean, feedback:string, missing:string[]'
);
verifier.setInstruction(
  'You are an independent rubric grader, not a self-critique. Pass only when the evidence clearly satisfies every part of the rubric.'
);

// In-memory rule store. Verified, reusable rules go here — not raw failure notes.
const memoryStore = new Map<string, string>();

// ---------------------------------------------------------------------------
// Tool catalog across three namespaces. functionDiscovery lets the agent pull
// in the ones it needs instead of carrying all of them in every prompt.
// ---------------------------------------------------------------------------
const runExperiment = fn('runExperiment')
  .namespace('lab')
  .description(
    'Run one experiment: apply an ETL config plan and return the score, whether it is solved, and — for any failing check — the exact fix to apply. Start with an empty plan to see every fix.'
  )
  .arg(
    'plan',
    f.string(
      'Config plan as key=value flags, e.g. "nullPolicy=impute, dedup=on, coerceTypes=on, trim=on, outlier=clip". Pass "" to discover the fixes.'
    )
  )
  .returns(
    f.json(
      'Experiment result: score, solved, passed[], failed[{check,fix}], logs'
    )
  )
  .handler(({ plan }) => runInSandbox(plan))
  .build();

const listChecks = fn('listChecks')
  .namespace('lab')
  .description('List the data-quality checks the experiment evaluates.')
  .returns(f.string('Check name').array())
  .handler(() => CHECKS)
  .build();

const grade = fn('grade')
  .namespace('verifier')
  .description(
    'Independent rubric grader. Pass only when the evidence meets the rubric.'
  )
  .arg('rubric', f.string('The rubric to grade against'))
  .arg('evidence', f.string('Observed experiment results').array())
  .returns(f.json('Verifier result: passed, feedback, missing[]'))
  .handler(({ rubric, evidence }) =>
    verifier.forward(llm, { rubric, evidence })
  )
  .build();

const recall = fn('recall')
  .namespace('memory')
  .description('Recall verified rules relevant to a topic.')
  .arg('topic', f.string('Topic to search remembered rules for'))
  .returns(f.string('A verified rule').array())
  .handler(({ topic }) => {
    const t = topic.toLowerCase();
    return [...memoryStore.entries()]
      .filter(
        ([key]) =>
          key.includes(t) ||
          t.includes(key) ||
          t.split(' ').some((w) => key.includes(w))
      )
      .map(([, value]) => value);
  })
  .build();

const remember = fn('remember')
  .namespace('memory')
  .description(
    'Store a verified, reusable rule. Store the distilled rule, not raw failure notes.'
  )
  .arg('rule', f.string('Verified general rule'))
  .arg('evidence', f.string('Why it is true'))
  .returns(f.json('Stored confirmation'))
  .handler(({ rule, evidence }) => {
    memoryStore.set(rule.toLowerCase().slice(0, 48), `${rule} :: ${evidence}`);
    return { stored: true, total: memoryStore.size };
  })
  .build();

const listMemory = fn('list')
  .namespace('memory')
  .description('List every rule currently in memory.')
  .returns(f.string('A stored rule').array())
  .handler(() => [...memoryStore.values()])
  .build();

const selfImprovingAgent = agent(
  'goal:string, rubric:string -> answer:string, experiments:string[] "Plans tried, in order", learnedRules:string[]',
  {
    runtime: new AxJSRuntime(),
    contextFields: [],
    functions: [runExperiment, listChecks, grade, recall, remember, listMemory],
    contextPolicy: {
      preset: 'adaptive',
      budget: 'balanced',
    },
    maxTurns: 18,
    executorOptions: {
      description: [
        'Use the tools — do not answer from your own knowledge.',
        '1. Call memory.recall("etl data quality") to reuse anything already learned.',
        '2. Call lab.runExperiment("") once to see every failing check and its fix.',
        '3. Build a plan that applies all the fixes, then call lab.runExperiment again. Repeat until the result has solved=true.',
        '4. Call verifier.grade with the passing evidence against the rubric.',
        '5. For EACH check you fixed, call memory.remember(rule, evidence) — store the reusable rule, not raw notes.',
        '6. Only after the rules are stored, return the answer, the plans you tried, and the learned rules.',
      ].join('\n'),
    },
  }
);

const result = await selfImprovingAgent.forward(llm, {
  goal: 'Find an ETL config plan that cleans the dirty dataset so every data-quality check passes.',
  rubric:
    'All five checks (no-nulls, no-duplicates, numeric-types, trimmed-strings, outliers-handled) must pass, i.e. score 1.0.',
});

console.log(JSON.stringify(result, null, 2));

// Persist the agent's verified rules so a future run's memory.recall reuses them.
// (The agent may also call memory.remember mid-run; this guarantees the durable
// store is populated either way.)
for (const rule of result.learnedRules) {
  memoryStore.set(rule.toLowerCase().slice(0, 48), rule);
}
console.log(`\nMemory now holds ${memoryStore.size} rule(s) for next time:`);
console.log([...memoryStore.values()].map((r) => ` • ${r}`).join('\n'));
