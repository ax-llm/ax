/**
 * Conclusive A/B eval for the advisory relevance ranker (`relevanceRanking`).
 *
 * Measures whether the "Likely Relevant Modules" hint improves the model's
 * FIRST-PASS discovery decision — the thing the hint actually targets — not
 * just downstream tool use. Postmortem fixes over the first harness:
 *
 *  1. TOOL-FORCING tasks: every answer is a fictional fact behind exactly one
 *     module's lookup function, so the model cannot answer parametrically.
 *     Answers are judged on SUBSTANCE — paraphrase-invariant tokens (proper
 *     nouns, distinctive numbers) that any faithful answer must retain — with
 *     verbatim reference-code retention kept as a secondary metric only.
 *     (Verbatim-only judging penalized correct paraphrases and polluted an
 *     earlier control run.)
 *  2. Records ALL `onFunctionCall` events — internal calls included. The
 *     `discover` primitive fires as `{name:'discover', args:{request}, kind:'internal'}`,
 *     which the previous harness filtered out.
 *  3. Cross-checks recorded discover calls against the public
 *     `getState().actionLogEntries[].code` (instrumentation-gap detector).
 *  4. Repeats each task×variant `EVAL_REPEATS` times (default 3), interleaved,
 *     fresh agent per run.
 *
 * Run (small model is the target):
 *   OPENAI_APIKEY=... EVAL_MODEL=gpt-5.4-mini EVAL_REPEATS=3 \
 *     npx tsx src/examples/module-ranking-eval.ts
 */
import { type AxAgentFunctionGroup, agent, ai } from '@ax-llm/ax';

const apiKey = process.env.OPENAI_APIKEY;
const model = process.env.EVAL_MODEL ?? 'gpt-5.4-mini';
const repeats = Math.max(1, Number(process.env.EVAL_REPEATS ?? 3) || 3);

if (!apiKey) {
  console.log(
    'Skipping: set OPENAI_APIKEY (and optionally EVAL_MODEL, EVAL_REPEATS) to run the live A/B eval.'
  );
  process.exit(0);
}

const llm = ai({
  name: 'openai',
  apiKey,
  // No temperature override — some gpt-5.x models only accept the default.
  config: { model },
});

const str = (description: string) => ({ type: 'string' as const, description });

const lookup =
  (payload: Record<string, unknown>) =>
  async (): Promise<Record<string, unknown>> =>
    payload;

/**
 * Seven modules with deliberately overlapping vocabulary ("customer",
 * "account", "status", "schedule") so first-pass selection is non-trivial.
 * Every function returns a nonce fact that cannot be fabricated.
 */
function buildModules(): AxAgentFunctionGroup[] {
  return [
    {
      namespace: 'orders',
      title: 'Customer Orders',
      selectionCriteria:
        'Use for customer order status, shipments, and delivery tracking.',
      functions: [
        {
          name: 'lookupOrder',
          description: 'Look up a customer order by order id',
          parameters: {
            type: 'object',
            properties: { id: str('Order id, e.g. VX-9931') },
            required: ['id'],
          },
          func: lookup({
            id: 'VX-9931',
            status: 'delayed at customs in Rotterdam (ref DLY-9931)',
          }),
        },
      ],
    },
    {
      namespace: 'billing',
      title: 'Billing & Invoices',
      selectionCriteria:
        'Use for invoices, charges, payment status, and refunds on customer accounts.',
      functions: [
        {
          name: 'lookupInvoice',
          description: 'Look up an invoice by invoice id',
          parameters: {
            type: 'object',
            properties: { id: str('Invoice id, e.g. INV-2207') },
            required: ['id'],
          },
          func: lookup({
            id: 'INV-2207',
            paymentStatus: 'paid in full by wire transfer (ref WIRE-2207)',
          }),
        },
      ],
    },
    {
      namespace: 'inventory',
      title: 'Warehouse Inventory',
      selectionCriteria:
        'Use for warehouse stock levels and SKU availability checks.',
      functions: [
        {
          name: 'checkStock',
          description: 'Check available stock for a SKU',
          parameters: {
            type: 'object',
            properties: { sku: str('SKU code, e.g. WH-77') },
            required: ['sku'],
          },
          func: lookup({
            sku: 'WH-77',
            available: '312 units at the Osaka warehouse (lot OSK-7741)',
          }),
        },
      ],
    },
    {
      namespace: 'crm',
      title: 'Customer Accounts (CRM)',
      selectionCriteria:
        'Use for customer account records, contacts, and assigned account managers.',
      functions: [
        {
          name: 'lookupAccount',
          description: 'Look up a customer account by account id',
          parameters: {
            type: 'object',
            properties: { id: str('Account id, e.g. AC-5501') },
            required: ['id'],
          },
          func: lookup({
            id: 'AC-5501',
            accountManager: 'Priya Kovacs (badge KV-5501)',
          }),
        },
      ],
    },
    {
      namespace: 'hr',
      title: 'Employee Records (HR)',
      selectionCriteria:
        'Use for employee records, leave balances, and org chart questions.',
      functions: [
        {
          name: 'lookupEmployee',
          description: 'Look up an employee record by employee id',
          parameters: {
            type: 'object',
            properties: { id: str('Employee id, e.g. EMP-3319') },
            required: ['id'],
          },
          func: lookup({
            id: 'EMP-3319',
            leaveBalance:
              '11.5 days of annual leave remaining (policy LV-1375)',
          }),
        },
      ],
    },
    {
      namespace: 'fleet',
      title: 'Vehicle Fleet',
      selectionCriteria:
        'Use for company vehicles, maintenance schedules, and vehicle assignments.',
      functions: [
        {
          name: 'lookupVehicle',
          description: 'Look up a fleet vehicle by vehicle id',
          parameters: {
            type: 'object',
            properties: { id: str('Vehicle id, e.g. FL-208') },
            required: ['id'],
          },
          func: lookup({
            id: 'FL-208',
            maintenanceDue: 'due 9 August at the Lyon depot (ticket MNT-0812)',
          }),
        },
      ],
    },
    {
      namespace: 'wiki',
      title: 'Internal Wiki',
      selectionCriteria:
        'Use for internal documentation, runbooks, and policy pages.',
      functions: [
        {
          name: 'getPage',
          description: 'Fetch an internal wiki page by slug',
          parameters: {
            type: 'object',
            properties: { slug: str('Page slug, e.g. incident-escalation') },
            required: ['slug'],
          },
          func: lookup({
            slug: 'incident-escalation',
            paging:
              'page Dana Osei first, then the platform on-call (rota RTA-XR42)',
          }),
        },
      ],
    },
  ];
}

/**
 * Every task's answer is a fictional fact behind exactly one module.
 * `substance` = paraphrase-invariant tokens (proper nouns, distinctive
 * numbers) any faithful answer must retain — the PRIMARY judge.
 * `nonce` = the verbatim reference code — SECONDARY (verbatimness only).
 */
const TASKS: {
  query: string;
  expect: string;
  substance: RegExp[];
  nonce: string;
}[] = [
  {
    query: 'What is the current status of customer order VX-9931?',
    expect: 'orders',
    substance: [/customs/i, /rotterdam/i],
    nonce: 'DLY-9931',
  },
  {
    query: 'Has invoice INV-2207 been paid, and how?',
    expect: 'billing',
    substance: [/paid/i, /wire/i],
    nonce: 'WIRE-2207',
  },
  {
    query: 'How many units of SKU WH-77 are available in the warehouse?',
    expect: 'inventory',
    substance: [/\b312\b/, /osaka/i],
    nonce: 'OSK-7741',
  },
  {
    query: 'Who is the account manager for customer account AC-5501?',
    expect: 'crm',
    substance: [/kovacs/i],
    nonce: 'KV-5501',
  },
  {
    query: 'What is the remaining leave balance for employee EMP-3319?',
    expect: 'hr',
    substance: [/11\.5/],
    nonce: 'LV-1375',
  },
  {
    query: 'When and where is fleet vehicle FL-208 due for maintenance?',
    expect: 'fleet',
    substance: [/august/i, /lyon/i],
    nonce: 'MNT-0812',
  },
  {
    query:
      "According to the internal runbook page 'incident-escalation', who gets paged first?",
    expect: 'wiki',
    substance: [/osei/i],
    nonce: 'RTA-XR42',
  },
];

// ----- Recording -----

interface RecordedCall {
  name: string;
  qualifiedName: string;
  kind: 'internal' | 'external';
  args: Record<string, unknown>;
}

/** Normalize discover(...) input (string | string[] | {tools}) to module parts. */
function discoverRequestToModules(request: unknown): string[] {
  const items: string[] = [];
  const collect = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) items.push(value.trim());
    else if (Array.isArray(value)) for (const v of value) collect(v);
    else if (value && typeof value === 'object') {
      collect((value as { tools?: unknown }).tools);
    }
  };
  collect(request);
  // Qualified function names count toward their module.
  const modules: string[] = [];
  for (const item of items) {
    const moduleName = item.split('.')[0] ?? item;
    if (!modules.includes(moduleName)) modules.push(moduleName);
  }
  return modules;
}

interface RunResult {
  expect: string;
  /** PRIMARY: all paraphrase-invariant substance tokens present. */
  substanceHit: boolean;
  /** SECONDARY: verbatim reference code retained. */
  nonceHit: boolean;
  turns: number;
  // Discovery decision (the hint's actual target)
  firstDiscoverModules: string[]; // ordered unique modules in the FIRST discover
  discoverP1: boolean; // first module of first discover === expected
  discoverContains: boolean; // expected anywhere in first discover
  wrongDiscovered: number; // distinct non-expected modules discovered (whole run)
  discoveredThenUsed: boolean; // expected discovered, then expected.* called
  usedExpected: boolean; // any external call on expected module
  // Ranker (ON variant only)
  rankerTop?: string;
  rankerSuppressed?: boolean;
  // Instrumentation cross-check
  codeDiscoverCount: number;
  recordedDiscoverCount: number;
  failure?: string;
}

async function runOnce(
  task: (typeof TASKS)[number],
  relevanceRanking: boolean
): Promise<RunResult> {
  const calls: RecordedCall[] = [];
  let rankerTop: string | undefined;
  let rankerSuppressed: boolean | undefined;

  const a = agent('query:string -> answer:string', {
    ai: llm,
    functions: buildModules(),
    functionDiscovery: true,
    relevanceRanking,
    maxTurns: 8,
    onFunctionCall: (call) => {
      calls.push({
        name: call.name,
        qualifiedName: call.qualifiedName,
        kind: call.kind,
        args: call.args as Record<string, unknown>,
      });
    },
    onContextEvent: (event) => {
      // Tolerate both the current and the post-rename event shapes.
      const e = event as {
        kind: string;
        domain?: string;
        suppressed?: boolean;
        shortlist?: { namespace?: string; id?: string }[];
      };
      const isModuleRanking =
        e.kind === 'module_ranking' ||
        (e.kind === 'relevance_ranking' && e.domain === 'modules');
      if (isModuleRanking && rankerSuppressed === undefined) {
        rankerSuppressed = e.suppressed === true;
        const top = e.shortlist?.[0];
        rankerTop = top?.namespace ?? top?.id;
      }
    },
  });

  let answer = '';
  let failure: string | undefined;
  try {
    const res = await a.forward(llm, { query: task.query });
    answer = String((res as { answer?: unknown }).answer ?? '');
  } catch (err) {
    failure = String(err).slice(0, 120);
  }

  // --- Derive discovery metrics from the recorded calls (order-preserving) ---
  const discoverCalls = calls.filter(
    (c) => c.kind === 'internal' && c.name === 'discover'
  );
  const firstDiscoverModules =
    discoverCalls.length > 0
      ? discoverRequestToModules(discoverCalls[0]?.args.request)
      : [];
  const allDiscovered = new Set(
    discoverCalls.flatMap((c) => discoverRequestToModules(c.args.request))
  );
  const knownModules = new Set(buildModules().map((g) => g.namespace));
  const wrongDiscovered = [...allDiscovered].filter(
    (m) => knownModules.has(m) && m !== task.expect
  ).length;

  const firstDiscoverIdxNamingExpected = calls.findIndex(
    (c) =>
      c.kind === 'internal' &&
      c.name === 'discover' &&
      discoverRequestToModules(c.args.request).includes(task.expect)
  );
  const usedExpectedIdx = calls.findIndex(
    (c) =>
      c.kind === 'external' && c.qualifiedName.startsWith(`${task.expect}.`)
  );

  // --- Instrumentation cross-check via public state ---
  const state = a.getState() as
    | { actionLogEntries?: { code?: string }[] }
    | undefined;
  const codeDiscoverCount = (state?.actionLogEntries ?? []).reduce(
    (n, entry) => n + (/\bdiscover\s*\(/.test(entry.code ?? '') ? 1 : 0),
    0
  );

  return {
    expect: task.expect,
    substanceHit: task.substance.every((re) => re.test(answer)),
    nonceHit: answer.includes(task.nonce),
    turns: state?.actionLogEntries?.length ?? 0,
    firstDiscoverModules,
    discoverP1: firstDiscoverModules[0] === task.expect,
    discoverContains: firstDiscoverModules.includes(task.expect),
    wrongDiscovered,
    discoveredThenUsed:
      firstDiscoverIdxNamingExpected >= 0 &&
      usedExpectedIdx > firstDiscoverIdxNamingExpected,
    usedExpected: usedExpectedIdx >= 0,
    rankerTop,
    rankerSuppressed,
    codeDiscoverCount,
    recordedDiscoverCount: discoverCalls.length,
    failure,
  };
}

// ----- Reporting -----

const pct = (n: number, d: number) =>
  d === 0 ? '—' : `${Math.round((100 * n) / d)}%`;

function summarize(label: string, rows: RunResult[]) {
  const withDiscover = rows.filter((r) => r.recordedDiscoverCount > 0);
  const p1 = rows.filter((r) => r.discoverP1).length;
  const contains = rows.filter((r) => r.discoverContains).length;
  const substance = rows.filter((r) => r.substanceHit).length;
  const nonce = rows.filter((r) => r.nonceHit).length;
  const dtu = rows.filter((r) => r.discoveredThenUsed).length;
  const used = rows.filter((r) => r.usedExpected).length;
  const avgTurns = rows.reduce((s, r) => s + r.turns, 0) / (rows.length || 1);
  const avgWrong =
    rows.reduce((s, r) => s + r.wrongDiscovered, 0) / (rows.length || 1);
  const gaps = rows.filter(
    (r) => r.codeDiscoverCount !== r.recordedDiscoverCount
  ).length;
  const failures = rows.filter((r) => r.failure).length;

  console.log(`\n=== ${label} (${rows.length} runs) ===`);
  console.log(
    `  discover-precision@1:   ${pct(p1, rows.length)} (${p1}/${rows.length})`
  );
  console.log(
    `  first-discover-contains:${pct(contains, rows.length)} (${contains}/${rows.length})`
  );
  console.log(
    `  discovered-then-used:   ${pct(dtu, rows.length)} (${dtu}/${rows.length})`
  );
  console.log(
    `  used-expected-module:   ${pct(used, rows.length)} (${used}/${rows.length})`
  );
  console.log(
    `  substance accuracy:     ${pct(substance, rows.length)} (${substance}/${rows.length})  <- PRIMARY`
  );
  console.log(
    `  verbatim-code retention:${pct(nonce, rows.length)} (${nonce}/${rows.length})`
  );
  console.log(`  avg wrong-discovers:    ${avgWrong.toFixed(2)}`);
  console.log(`  avg turns:              ${avgTurns.toFixed(2)}`);
  console.log(
    `  ran discover at all:    ${pct(withDiscover.length, rows.length)}`
  );
  if (gaps > 0)
    console.log(
      `  ⚠ instrumentation gaps:  ${gaps} run(s) (code vs recorded discover count mismatch)`
    );
  if (failures > 0) console.log(`  ⚠ failed forwards:       ${failures}`);

  const ranked = rows.filter((r) => r.rankerSuppressed === false);
  if (ranked.length > 0) {
    const rp1 = ranked.filter((r) => r.rankerTop === r.expect).length;
    console.log(
      `  ranker precision@1:     ${pct(rp1, ranked.length)} (${rp1}/${ranked.length}); suppressed in ${rows.filter((r) => r.rankerSuppressed).length}`
    );
  }
}

async function main() {
  console.log(
    `Model: ${model} | tasks: ${TASKS.length} | repeats: ${repeats} | runs per variant: ${TASKS.length * repeats}\n`
  );
  const off: RunResult[] = [];
  const on: RunResult[] = [];
  for (const task of TASKS) {
    for (let i = 0; i < repeats; i++) {
      // Interleave variants within each repeat to spread provider drift evenly.
      process.stdout.write(
        `  [${task.expect}] repeat ${i + 1}/${repeats} off…`
      );
      off.push(await runOnce(task, false));
      process.stdout.write(' on…');
      on.push(await runOnce(task, true));
      process.stdout.write('\n');
    }
  }

  summarize('relevanceRanking OFF', off);
  summarize('relevanceRanking ON', on);

  const offP1 = off.filter((r) => r.discoverP1).length;
  const onP1 = on.filter((r) => r.discoverP1).length;
  const offSub = off.filter((r) => r.substanceHit).length;
  const onSub = on.filter((r) => r.substanceHit).length;
  console.log(
    `\nDecision signal — discover-precision@1: ${pct(offP1, off.length)} -> ${pct(onP1, on.length)} (off -> on); substance accuracy: ${pct(offSub, off.length)} -> ${pct(onSub, on.length)}.`
  );
  console.log(
    'Gate: flip RELEVANCE_RANKING_DEFAULT only if ON wins on the small model (discover-precision@1 AND substance) and a large-model control shows no substance regression beyond tolerance.'
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
