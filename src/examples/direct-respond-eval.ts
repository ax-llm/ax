/**
 * Landing-gate eval for direct-respond (`respond(task, evidence)` skipping the
 * executor stage). Three scenario sets, live models, interleaved repeats,
 * fresh agent per run (module-ranking-eval.ts harness conventions):
 *
 *  1. MUST-NOT-SKIP (hard gate: 0 false skips): every task needs a registered
 *     function — a nonce fact behind exactly one module's lookup, a STALE-
 *     CONTEXT TRAP (the context carries an outdated status; only the live
 *     tool has the fresh nonce), an effectful ask (send + report receipt),
 *     and a context+tool mix. A distiller `respond()` here is a false skip.
 *     Substance judging is paraphrase-invariant nonce tokens, so a stale
 *     answer is also detectable even when the pipeline "answers".
 *  2. SHOULD-SKIP (gate: skip recall >= 0.8): pure context Q&A over meeting
 *     notes while the SAME irrelevant function modules stay registered
 *     (overlapping vocabulary, per the module-ranking-eval design).
 *  3. STATIC (report: deterministic skip): the same Q&A tasks on a
 *     function-less agent, which renders the respond-only distiller prompt.
 *
 * A/B: the must-not-skip set also runs with `directResponse: 'off'` — if the
 * covenant loosening eroded the distiller's forwarding behavior, the 'auto'
 * variant's substance accuracy or tool-use rate drops against 'off'.
 *
 * Skip detection: fresh agent per run, so `getStagedUsage().task.actor`
 * empty ⇔ the executor made zero model calls; cross-checked against
 * executor-tagged chat-log entries.
 *
 * Run (repo-pinned models):
 *   OPENAI_APIKEY=... EVAL_MODEL=gpt-5.4-mini EVAL_REPEATS=3 \
 *     npx tsx src/examples/direct-respond-eval.ts
 *   Add GOOGLE_APIKEY=... to also run the gemini-3.5-flash lane.
 */
import { type AxAgentFunctionGroup, agent, ai } from '@ax-llm/ax';

const openaiKey = process.env.OPENAI_APIKEY;
const googleKey = process.env.GOOGLE_APIKEY;
const openaiModel = process.env.EVAL_MODEL ?? 'gpt-5.4-mini';
const googleModel = process.env.EVAL_GOOGLE_MODEL ?? 'gemini-3.5-flash';
const repeats = Math.max(1, Number(process.env.EVAL_REPEATS ?? 3) || 3);

if (!openaiKey && !googleKey) {
  console.log(
    'Skipping: set OPENAI_APIKEY and/or GOOGLE_APIKEY (and optionally EVAL_MODEL, EVAL_REPEATS) to run the live direct-respond gate.'
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
      config: { model: openaiModel },
    }),
  });
}
if (googleKey) {
  lanes.push({
    label: `google/${googleModel}`,
    llm: ai({
      name: 'google-gemini',
      apiKey: googleKey,
      config: { model: googleModel },
    }),
  });
}

const str = (description: string) => ({ type: 'string' as const, description });
const lookup =
  (payload: Record<string, unknown>) =>
  async (): Promise<Record<string, unknown>> =>
    payload;

/**
 * Function modules with vocabulary that overlaps the notes corpus
 * ("order", "invoice", "SKU", "support") so should-skip discrimination is
 * non-trivial. Every return value is a nonce that cannot be fabricated.
 */
function buildModules(): AxAgentFunctionGroup[] {
  return [
    {
      namespace: 'orders',
      title: 'Customer Orders',
      selectionCriteria:
        'Use for live customer order status, shipments, and delivery tracking.',
      functions: [
        {
          name: 'lookupOrder',
          description: 'Look up the CURRENT status of an order by order id',
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
        'Use for live invoice payment status, charges, and refunds.',
      functions: [
        {
          name: 'lookupInvoice',
          description: 'Look up the payment status of an invoice by id',
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
      selectionCriteria: 'Use for live warehouse stock levels by SKU.',
      functions: [
        {
          name: 'checkStock',
          description: 'Check the live available stock for a SKU',
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
      namespace: 'mailer',
      title: 'Transactional Email',
      selectionCriteria:
        'Use to send transactional emails (password resets, receipts).',
      functions: [
        {
          name: 'sendPasswordReset',
          description: 'Send a password-reset email to an address',
          parameters: {
            type: 'object',
            properties: { to: str('Recipient email address') },
            required: ['to'],
          },
          func: lookup({ sent: true, receiptId: 'RCPT-8842' }),
        },
      ],
    },
  ];
}

/** Notes corpus: nonce facts for should-skip + a stale trap for must-not-skip. */
const NOTES = [
  '# Ops sync notes (May 12)',
  '',
  'Order watchlist (as of LAST WEEK, may be outdated): VX-9931 was "processing at origin warehouse".',
  'The team flagged SKU WH-77 for a stock check.',
  'Open invoices mentioned: INV-2207 (status unknown at meeting time).',
  '',
  'Action items:',
  '- Priya: run the quarterly latency review.',
  '- Priya: refresh the Helsinki fixture data.',
  '- Marcus: draft the on-call handbook page.',
  '',
  'Decision: adopt tiered caching behind flag CACHE-TIER-11 starting May.',
  'Support rotation this week: Marcus.',
  '',
  'Migration risks called out: vendor lock-in, and a rollback window shorter than one release cycle.',
].join('\n');

interface EvalTask {
  id: string;
  query: string;
  /** Paraphrase-invariant tokens any faithful answer must retain. */
  substance: RegExp[];
  /** Module whose function the task requires (must-not-skip only). */
  requires?: string;
}

const MUST_NOT_SKIP: EvalTask[] = [
  {
    id: 'stale-trap',
    query:
      'What is the CURRENT shipping status of order VX-9931? Check the order system for the live status.',
    substance: [/rotterdam/i, /DLY-9931/i],
    requires: 'orders',
  },
  {
    id: 'effectful-send',
    query:
      'Send the password-reset email to dana@example.com and report the delivery receipt id.',
    substance: [/RCPT-8842/i],
    requires: 'mailer',
  },
  {
    id: 'tool-fact',
    query:
      'Has invoice INV-2207 been paid? Verify the payment status in the billing system.',
    substance: [/WIRE-2207/i],
    requires: 'billing',
  },
  {
    id: 'context-plus-tool',
    query:
      'Which SKU did the team flag in the notes, and what is its live stock level right now?',
    substance: [/WH-77/i, /312/],
    requires: 'inventory',
  },
];

const SHOULD_SKIP: EvalTask[] = [
  {
    id: 'action-items',
    query: 'According to the notes, which action items are assigned to Priya?',
    substance: [/quarterly latency review/i, /Helsinki fixture data/i],
  },
  {
    id: 'decision',
    query:
      'Summarize the key decision recorded in the notes about the caching rollout.',
    substance: [/CACHE-TIER-11/i],
  },
  {
    id: 'rotation',
    query: 'Who is on support rotation this week according to the notes?',
    substance: [/Marcus/i],
  },
  {
    id: 'risks',
    query: 'List the migration risks called out in the notes.',
    substance: [/vendor lock-?in/i, /rollback window/i],
  },
];

interface RunResult {
  taskId: string;
  variant: string;
  skipped: boolean;
  substanceHit: boolean;
  toolUsedExpected: boolean;
  failure?: string;
}

async function runOnce(
  llm: ReturnType<typeof ai>,
  task: EvalTask,
  options: Readonly<{
    withFunctions: boolean;
    directResponse: 'auto' | 'off';
    variant: string;
  }>
): Promise<RunResult> {
  const externalCalls: string[] = [];
  const a = agent('notes:string, query:string -> answer:string', {
    ai: llm,
    contextFields: ['notes'],
    ...(options.withFunctions ? { functions: buildModules() } : {}),
    directResponse: options.directResponse,
    maxTurns: 8,
    onFunctionCall: (call) => {
      if (call.kind === 'external') externalCalls.push(call.qualifiedName);
    },
  });

  let answer = '';
  let failure: string | undefined;
  try {
    const res = await a.forward(llm, { notes: NOTES, query: task.query });
    answer = String((res as { answer?: unknown }).answer ?? '');
  } catch (err) {
    failure = String(err).slice(0, 140);
  }

  // Skip detection: fresh agent per run — zero executor model calls means
  // the direct-respond path ran. Cross-checked against executor chat entries.
  const staged = a.getStagedUsage();
  const usageSaysSkipped = (staged.task.actor?.length ?? 0) === 0;
  const chatSaysExecutorRan = a
    .getChatLog()
    .some((entry) => (entry as { name?: string }).name === 'executor');
  const skipped = usageSaysSkipped && !chatSaysExecutorRan;

  return {
    taskId: task.id,
    variant: options.variant,
    skipped,
    substanceHit: !failure && task.substance.every((re) => re.test(answer)),
    toolUsedExpected: task.requires
      ? externalCalls.some((name) => name.startsWith(`${task.requires}.`))
      : false,
    failure,
  };
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
  options: Parameters<typeof runOnce>[2]
): Promise<RunResult> {
  const first = await runOnce(llm, task, options);
  if (first.failure && TRANSIENT.test(first.failure)) {
    console.log(
      `  [retry] ${options.variant}/${task.id}: ${first.failure.slice(0, 80)}`
    );
    return runOnce(llm, task, options);
  }
  return first;
}

const pct = (n: number, d: number) =>
  d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(0)}% (${n}/${d})`;

async function runLane(label: string, llm: ReturnType<typeof ai>) {
  const results: RunResult[] = [];
  for (let r = 0; r < repeats; r++) {
    for (const task of MUST_NOT_SKIP) {
      results.push(
        await runOnceWithRetry(llm, task, {
          withFunctions: true,
          directResponse: 'auto',
          variant: 'guard-auto',
        })
      );
      results.push(
        await runOnceWithRetry(llm, task, {
          withFunctions: true,
          directResponse: 'off',
          variant: 'guard-off',
        })
      );
    }
    for (const task of SHOULD_SKIP) {
      results.push(
        await runOnceWithRetry(llm, task, {
          withFunctions: true,
          directResponse: 'auto',
          variant: 'skip-auto',
        })
      );
      results.push(
        await runOnceWithRetry(llm, task, {
          withFunctions: false,
          directResponse: 'auto',
          variant: 'static-auto',
        })
      );
    }
    console.log(`[${label}] repeat ${r + 1}/${repeats} done`);
  }

  const of = (variant: string) => results.filter((x) => x.variant === variant);
  const guardAuto = of('guard-auto');
  const guardOff = of('guard-off');
  const skipAuto = of('skip-auto');
  const staticAuto = of('static-auto');

  const falseSkips = guardAuto.filter((x) => x.skipped);
  const skipRecall = skipAuto.filter((x) => x.skipped);
  const staticSkips = staticAuto.filter((x) => x.skipped);
  const failures = results.filter((x) => x.failure);

  console.log(`\n=== ${label} ===`);
  console.log(
    `must-not-skip  false-skip rate: ${pct(falseSkips.length, guardAuto.length)}  ` +
      `substance auto: ${pct(guardAuto.filter((x) => x.substanceHit).length, guardAuto.length)}  ` +
      `off: ${pct(guardOff.filter((x) => x.substanceHit).length, guardOff.length)}  ` +
      `tool-used auto: ${pct(guardAuto.filter((x) => x.toolUsedExpected).length, guardAuto.length)}  ` +
      `off: ${pct(guardOff.filter((x) => x.toolUsedExpected).length, guardOff.length)}`
  );
  console.log(
    `should-skip    skip recall: ${pct(skipRecall.length, skipAuto.length)}  ` +
      `substance (skipped runs): ${pct(
        skipRecall.filter((x) => x.substanceHit).length,
        skipRecall.length
      )}  substance (all): ${pct(skipAuto.filter((x) => x.substanceHit).length, skipAuto.length)}`
  );
  console.log(
    `static         skip rate: ${pct(staticSkips.length, staticAuto.length)}  ` +
      `substance: ${pct(staticAuto.filter((x) => x.substanceHit).length, staticAuto.length)}`
  );
  if (falseSkips.length > 0) {
    for (const x of falseSkips) {
      console.log(`  FALSE SKIP: ${x.taskId}`);
    }
  }
  if (failures.length > 0) {
    for (const x of failures) {
      console.log(`  RUN FAILURE: ${x.variant}/${x.taskId}: ${x.failure}`);
    }
  }

  const gates = {
    falseSkipZero: falseSkips.length === 0,
    skipRecall:
      skipAuto.length > 0 && skipRecall.length / skipAuto.length >= 0.8,
    substanceParity:
      guardAuto.filter((x) => x.substanceHit).length >=
      guardOff.filter((x) => x.substanceHit).length -
        Math.ceil(guardOff.length * 0.15),
  };
  console.log(
    `gates          0-false-skips: ${gates.falseSkipZero ? 'PASS' : 'FAIL'}  ` +
      `skip-recall>=80%: ${gates.skipRecall ? 'PASS' : 'FAIL'}  ` +
      `substance-parity(auto>=off-15%): ${gates.substanceParity ? 'PASS' : 'FAIL'}`
  );
  return gates.falseSkipZero && gates.skipRecall && gates.substanceParity;
}

let allPass = true;
for (const lane of lanes) {
  allPass = (await runLane(lane.label, lane.llm)) && allPass;
}
console.log(`\nDIRECT-RESPOND GATE: ${allPass ? 'PASS' : 'FAIL'}`);
process.exit(allPass ? 0 : 1);
