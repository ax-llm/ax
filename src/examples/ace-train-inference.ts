import 'dotenv/config';

import {
  AxAI,
  AxAIOpenAIModel,
  AxACE,
  type AxACEBullet,
  type AxACECuratorOutput,
  type AxACEPlaybook,
  type AxMetricFn,
  ax,
  f,
} from '@ax-llm/ax';

type SeverityExample = {
  ticket: string;
  impact: string;
  scope: 'single-user' | 'regional' | 'global' | 'internal';
  signals: string;
  severity: 'low' | 'medium' | 'high';
  policyHint?: string;
};

async function run() {
  const student = new AxAI({
    name: 'openai',
    apiKey: process.env.OPENAI_APIKEY!,
    config: { model: AxAIOpenAIModel.GPT41Mini, temperature: 0.5 },
  });

  // For example runtime we reuse the student as the "teacher" so reflections happen quickly.
  // In production you would typically provide a stronger model here.
  const teacher = student;

  const signatureSource = f()
    .input('ticket', f.string('Concise incident summary'))
    .input('impact', f.string('Observed customer or business impact'))
    .input('scope', f.string('Reported scope of the issue'))
    .input('signals', f.string('Supporting telemetry or operational signals'))
    .output(
      'severity',
      f.class(['low', 'medium', 'high'], 'Incident severity label')
    )
    .output(
      'reasoning',
      f.string('Brief rationale referencing internal incident policy')
    )
    .build()
    .toString();

  const baseInstruction = `You are doing first-pass incident triage. Use the table below and do not deviate from it.
- single-user -> low
- regional -> medium
- global -> high
- internal -> low
Ignore contractual risk, VIP status, or policy hints. Always justify the severity strictly in terms of the table.`;

  const baseProgram = ax(signatureSource);
  baseProgram.setDescription(baseInstruction);

  const program = ax(signatureSource);
  program.setDescription(baseInstruction);

  const trainExamples: SeverityExample[] = [
    {
      ticket: 'Fraud rules flag 80% of card transactions in CA region',
      impact: 'Legitimate purchases blocked for many customers',
      scope: 'regional',
      signals: 'Chargeback rate flat, ruleset pushed 10 minutes ago',
      severity: 'high',
      policyHint: 'customer purchases blocked',
    },
    {
      ticket: 'Global search results delayed during planned reindex',
      impact: 'Catalog searchable but updates appear 20 minutes late',
      scope: 'global',
      signals: 'Maintenance ticket CAB-512 approved, no customer complaints',
      severity: 'medium',
      policyHint: 'planned maintenance',
    },
    {
      ticket: 'VIP trading desk cannot fetch live equities quotes',
      impact: 'Top-tier client paused trading; penalty clauses triggered',
      scope: 'single-user',
      signals:
        'Pager duty SEV-1 active, quote API returning 404 for client subnet',
      severity: 'high',
      policyHint: 'vip contractual penalties',
    },
    {
      ticket: 'Internal analytics dashboard shows stale finance data',
      impact: 'Financial planning team delayed; no external exposure',
      scope: 'internal',
      signals: 'ETL job lagging 60 minutes, status yellow',
      severity: 'low',
      policyHint: 'internal only',
    },
    {
      ticket: 'LATAM logistics portal intermittently rejects shipment labels',
      impact: 'Auto-retry succeeds after 2 attempts; manual fallback available',
      scope: 'regional',
      signals: 'Error rate 8%, throughput unaffected',
      severity: 'medium',
      policyHint: 'fallback available',
    },
    {
      ticket: 'Compliance scan disabled tax reporting pipeline for CFO',
      impact: 'Regulatory filings blocked; potential fines over $1M',
      scope: 'single-user',
      signals: 'SOX control 441 triggered, legal escalation requested',
      severity: 'high',
      policyHint: 'regulatory fines',
    },
    {
      ticket: 'US West checkout latency spikes but conversions steady',
      impact: 'Customers see delays yet payments succeed after retry',
      scope: 'regional',
      signals: 'Latency P95 9s, success rate 94%',
      severity: 'medium',
      policyHint: 'degraded but functional',
    },
    {
      ticket: 'Internal HR portal down during off-hours maintenance',
      impact: 'Employees cannot update profiles overnight; no payroll impact',
      scope: 'internal',
      signals: 'Maintenance window approved, status page updated',
      severity: 'low',
      policyHint: 'planned maintenance internal',
    },
  ];

  const evaluationSet: SeverityExample[] = [
    {
      ticket: 'CFO unable to approve payroll due to SSO assertion failure',
      impact: 'Payroll run blocked; quarter-end close delayed',
      scope: 'single-user',
      signals: 'SSO audit shows token expiration misconfiguration',
      severity: 'high',
      policyHint: 'executive payroll blocker',
    },
    {
      ticket: 'Global marketing emails delayed due to vendor throttling',
      impact: 'Emails arrive late; conversion impact not yet observed',
      scope: 'global',
      signals: 'Vendor SLA warning, backlog draining gradually',
      severity: 'medium',
      policyHint: 'degraded but functional',
    },
    {
      ticket: 'APAC push notifications down during regional campaign',
      impact: 'Campaign reach reduced; SMS fallback working',
      scope: 'regional',
      signals: 'Push gateway 503s, SMS queue healthy',
      severity: 'medium',
      policyHint: 'fallback available',
    },
    {
      ticket: 'Compliance dashboard offline hours before filing deadline',
      impact: 'Regulatory submission blocked; potential legal penalties',
      scope: 'internal',
      signals: 'Legal escalation open, SLA breach imminent',
      severity: 'high',
      policyHint: 'regulatory fines',
    },
    {
      ticket: 'VIP trading desk sees delayed quotes after network reroute',
      impact: 'High-value client threatened to cancel trades',
      scope: 'single-user',
      signals: 'Latency P99 14s, SEV-1 bridge active',
      severity: 'high',
      policyHint: 'vip contractual penalties',
    },
  ];

  const metricFn: AxMetricFn = ({ prediction, example }) => {
    const severityExample = example as SeverityExample;
    const predictedSeverity = (prediction as { severity?: string })?.severity;
    const reasoningText = (
      (prediction as { reasoning?: string })?.reasoning ?? ''
    ).toLowerCase();

    let score = 0;

    if (predictedSeverity === severityExample.severity) {
      score += 0.5;
    }

    if (reasoningText.includes(severityExample.scope)) {
      score += 0.1;
    }

    const impactKeywords = [
      'revenue',
      'blocked',
      'vip',
      'penalty',
      'penalties',
      'latency',
      'fallback',
      'telemetry',
      'pager',
      'compliance',
      'regulatory',
      'fines',
      'sla',
      'escalation',
      'customer',
      'business',
    ];

    if (impactKeywords.some((token) => reasoningText.includes(token))) {
      score += 0.15;
    }

    const mentionsImpact =
      reasoningText.includes('impact') ||
      reasoningText.includes('customers') ||
      reasoningText.includes('business');
    const mentionsSignals =
      reasoningText.includes('signals') ||
      reasoningText.includes('telemetry') ||
      reasoningText.includes('pager') ||
      reasoningText.includes('sla');
    if (mentionsImpact && mentionsSignals) {
      score += 0.1;
    }

    const policyHint = severityExample.policyHint?.toLowerCase();
    if (policyHint) {
      const tokens = policyHint
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length > 4);
      if (tokens.some((token) => reasoningText.includes(token))) {
        score += 0.15;
      }
    }

    if (
      reasoningText.includes('customer') ||
      reasoningText.includes('business')
    ) {
      score += 0.05;
    }

    return Math.min(1, score);
  };

  async function evaluateProgram(
    label: string,
    programUnderTest: ReturnType<typeof ax>
  ): Promise<number> {
    let total = 0;
    for (const example of evaluationSet) {
      const prediction = await programUnderTest.forward(student, example);
      const score = metricFn({ prediction, example });
      total += typeof score === 'number' ? score : 0;
    }
    const average = evaluationSet.length
      ? total / evaluationSet.length
      : Number.NaN;
    console.log(
      `${label}: ${(average * 100).toFixed(1)} average score over ${evaluationSet.length
      } cases`
    );
    return average;
  }

  const baselineScore = await evaluateProgram(
    'Baseline (scope-only policy)',
    baseProgram
  );

  const optimizer = new AxACE(
    {
      studentAI: student,
      teacherAI: teacher,
      verbose: true,
    },
    {
      maxEpochs: 2,
      allowDynamicSections: true,
    }
  );

  console.log('\n🚀 Running ACE offline optimization...');
  const result = await optimizer.compile(program, trainExamples, metricFn, {
    aceOptions: { maxEpochs: 2 },
  });

  const optimizedProgram = ax(signatureSource);
  optimizedProgram.setDescription(baseInstruction);
  result.optimizedProgram?.applyTo(optimizedProgram);

  console.log(
    `ACE produced ${result.artifact.history.length} curator update batch(es).`
  );
  if (result.artifact.history.length > 0) {
    console.log(
      'Latest curator operations:',
      JSON.stringify(result.artifact.history.at(-1), null, 2)
    );
  }
  if (result.artifact.feedback.length > 0) {
    console.log(
      '\nSample reflection:',
      JSON.stringify(result.artifact.feedback.at(-1), null, 2)
    );
  }

  const optimizedScore = await evaluateProgram(
    'After ACE optimization',
    optimizedProgram
  );

  const delta = (optimizedScore - baselineScore) * 100;
  console.log(`Δ Score: ${delta.toFixed(1)} points (higher is better)`);

  const playbook: AxACEPlaybook | undefined = result.playbook;
  if (playbook) {
    console.log('\n📘 Learned playbook sections:');
    for (const [section, bullets] of Object.entries(playbook.sections) as [
      string,
      AxACEBullet[],
    ][]) {
      const preview =
        bullets.length > 0 ? bullets[0]?.content.slice(0, 80) : '(none)';
      console.log(`- ${section}: ${bullets.length} bullets (e.g. ${preview})`);
    }
  }

  const newTicket: SeverityExample = {
    ticket:
      'VIP equities desk reports quote stream silent for priority client account',
    impact: 'Tier-1 customer cannot trade; contractual penalties kick in soon',
    scope: 'single-user',
    signals:
      'Quote service returns 503 for client subnet; pager rotation active',
    severity: 'high',
    policyHint: 'vip outage',
  };

  const optimizedPrediction = await optimizedProgram.forward(
    student,
    newTicket
  );

  console.log('\n🤖 Prediction with ACE-optimized playbook:');
  console.log(optimizedPrediction);

  console.log(
    '\n🧠 Applying online update with incident resolution feedback...'
  );
  const curatorDelta: AxACECuratorOutput | undefined =
    await optimizer.applyOnlineUpdate({
      example: newTicket,
      prediction: optimizedPrediction,
      feedback:
        'Escalation confirmed SEV-1. Reward guidance about VIP customer clauses.',
    });

  if (curatorDelta?.operations?.length) {
    console.log(
      `Added ${curatorDelta.operations.length} new playbook bullet(s) after online update.`
    );
  }
}

run().catch((error) => {
  console.error('💥 ACE example failed', error);
  process.exit(1);
});
