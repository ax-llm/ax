// Grounded audit: proof that an Ax RLM agent stays exact on a task with a
// deterministic right answer.
//
// The agent audits a 250-row ledger it never sees in its prompt (it is a
// runtime-only contextField), extracting the PROJECT-X slice, joining each
// row to policy thresholds pulled from discovered `erp.*` tools, and listing
// the transactions that breach approval. We compute the same result in plain
// code as ground truth and assert the agent matched it — total to the cent,
// count, and the exact sorted list of violating ids.
//
// What this demonstrates about the design:
//   - Bulky data stays in the shared runtime session. The executor prompt
//     carries a shape summary of the evidence, never the 250 rows — so the
//     prompt size is bounded regardless of ledger size.
//   - The agent joins each PROJECT-X row to its vendor tier and threshold via
//     the erp.* tools, then compares in code.
//   - Shape hints keep it honest: it writes `t.amountCents` (the real field),
//     not a guessed `t.amount`, because the evidence descriptor lists the
//     item keys.
//
// (For tools loaded on demand rather than up front, see rlm-discovery.ts.)
//
// This runs on a small, cheap model (Gemini Flash) and reliably reproduces the
// exact ground truth — the point being that the pipeline, not model size, is
// what keeps it grounded.
//
// Run: GOOGLE_APIKEY=... npm run tsx src/examples/agent-grounded-audit.ts
import { AxAIGoogleGeminiModel, AxJSRuntime, agent, ai } from '@ax-llm/ax';

const llm = ai({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY!,
  config: { model: AxAIGoogleGeminiModel.Gemini35Flash },
});

// ---- The domain: vendor risk tiers gate per-transaction approval limits ----

const VENDOR_TIER: Record<string, string> = {
  'v-01': 'low',
  'v-02': 'medium',
  'v-03': 'high',
  'v-04': 'medium',
  'v-05': 'high',
  'v-06': 'low',
};
const TIER_THRESHOLD_CENTS: Record<string, number> = {
  low: 80_000,
  medium: 50_000,
  high: 25_000,
};
const OTHER_PROJECTS = ['ATLAS', 'ORION', 'DELTA', 'KILO'];

// A 250-row ledger; ~15 rows belong to PROJECT-X, interleaved deterministically.
const vendors = Object.keys(VENDOR_TIER);
const ledger = Array.from({ length: 250 }, (_, i) => {
  const isX = i % 17 === 3;
  return {
    id: `txn-${2000 + i}`,
    project: isX ? 'PROJECT-X' : OTHER_PROJECTS[i % OTHER_PROJECTS.length],
    vendorId: vendors[(i * 7) % vendors.length],
    amountCents: 12_000 + ((i * 3517) % 95_000),
    memo: `Ledger entry ${i}: recurring obligation, PO ref ${9000 + i}.`,
  };
});

// ---- Ground truth, computed independently in plain code ----

const xRows = ledger.filter((t) => t.project === 'PROJECT-X');
const truth = {
  totalDollars: xRows.reduce((s, t) => s + t.amountCents, 0) / 100,
  count: xRows.length,
  violating: xRows
    .filter(
      (t) => t.amountCents > TIER_THRESHOLD_CENTS[VENDOR_TIER[t.vendorId]]
    )
    .map((t) => t.id)
    .sort(),
};

// ---- ERP tools the agent chains per vendor: tier -> threshold ----

const findVendor = {
  name: 'getVendor',
  description: 'Fetch a vendor record (including its riskTier) by vendor id',
  namespace: 'erp',
  parameters: {
    type: 'object' as const,
    properties: {
      vendorId: { type: 'string' as const, description: 'e.g. v-03' },
    },
    required: ['vendorId'],
  },
  func: async ({ vendorId }: { vendorId: string }) => {
    const riskTier = VENDOR_TIER[vendorId];
    return riskTier
      ? { vendorId, name: `Vendor ${vendorId}`, riskTier }
      : { error: `unknown vendor ${vendorId}` };
  },
};

const findPolicy = {
  name: 'getPolicy',
  description:
    'Fetch the approval policy (threshold) for a vendor risk tier: low | medium | high',
  namespace: 'erp',
  parameters: {
    type: 'object' as const,
    properties: {
      riskTier: { type: 'string' as const, description: 'low | medium | high' },
    },
    required: ['riskTier'],
  },
  func: async ({ riskTier }: { riskTier: string }) => {
    const approvalThresholdCents = TIER_THRESHOLD_CENTS[riskTier];
    return approvalThresholdCents !== undefined
      ? { riskTier, approvalThresholdCents }
      : { error: `unknown tier ${riskTier}` };
  },
};

// ---- The agent: ledger is a runtime-only contextField ----

const auditor = agent('ledger:json[], question:string -> report:string', {
  contextFields: ['ledger'],
  functions: [findVendor, findPolicy],
  runtime: new AxJSRuntime(),
});

const question =
  'Audit PROJECT-X in the ledger. Report (1) the total PROJECT-X spend in dollars, ' +
  '(2) the number of PROJECT-X transactions, and (3) the sorted list of PROJECT-X ' +
  'transaction ids whose amount exceeds the approval threshold for their vendor risk ' +
  'tier. Vendor risk tiers come from erp.getVendor; tier thresholds from erp.getPolicy.';

const result = await auditor.forward(llm, { ledger, question });
const report = String(result.report);

// ---- Verify the agent's answer against ground truth ----

const digits = report.replace(/[,$\s]/g, '');
const totalOk =
  digits.includes(truth.totalDollars.toFixed(2)) ||
  digits.includes(String(Math.round(truth.totalDollars)));
const countOk = new RegExp(`\\b${truth.count}\\b`).test(report);
const gotIds = [...new Set(report.match(/txn-\d+/g) ?? [])].sort();
const idsOk =
  gotIds.length === truth.violating.length &&
  gotIds.every((id, i) => id === truth.violating[i]);

console.log(`\n=== Agent report ===\n${report}`);
console.log('\n=== Ground truth ===');
console.log(
  `total   : $${truth.totalDollars.toFixed(2)}   -> ${totalOk ? 'MATCH' : 'MISS'}`
);
console.log(`count   : ${truth.count}   -> ${countOk ? 'MATCH' : 'MISS'}`);
console.log(
  `violating (${truth.violating.length}): ${truth.violating.join(', ')}   -> ${idsOk ? 'MATCH' : 'MISS'}`
);

// Usage: bulky ledger stayed out of the prompt — show the per-stage split.
const usage = auditor.getStagedUsage();
const sum = (arr: readonly { tokens?: { totalTokens?: number } }[]) =>
  arr.reduce((s, e) => s + (e.tokens?.totalTokens ?? 0), 0);
console.log('\n=== Tokens (getStagedUsage) ===');
console.log(`context/distiller: ${sum(usage.ctx?.actor ?? [])}`);
console.log(`executor         : ${sum(usage.task.actor)}`);
console.log(`responder        : ${sum(usage.task.responder)}`);

const pass = totalOk && countOk && idsOk;
console.log(
  `\n${pass ? 'PASS' : 'FAIL'} — agent ${pass ? 'matched' : 'did NOT match'} ground truth`
);
if (!pass) process.exit(1);
