import {
  type AxAgentFunctionGroup,
  AxAIGoogleGeminiModel,
  AxJSRuntime,
  AxJSRuntimePermission,
  agent,
  ai,
  f,
  fn,
} from '@ax-llm/ax';

const llm = ai({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY!,
  config: {
    model: AxAIGoogleGeminiModel.Gemini3Flash,
  },
});

const runtime = new AxJSRuntime({
  permissions: [AxJSRuntimePermission.TIMING],
});

const writingCoach = agent(
  'draft:string, audience:string -> revision:string "Polished revision for the requested audience"',
  {
    agentIdentity: {
      name: 'Writing Coach',
      description:
        'Rewrites draft text with clearer tone and structure for a target audience.',
    },
    contextFields: [],
    runtime,
  }
);

const handbookSnippets = [
  'Incident severity is determined by customer impact and duration.',
  'A mitigation is considered complete when affected user-facing actions recover.',
  'Postmortems require timeline, root cause, and follow-up owners.',
  'Escalate to on-call lead if mitigation takes longer than 20 minutes.',
];

const tools: AxAgentFunctionGroup[] = [
  {
    namespace: 'kb',
    title: 'Policy Knowledge Base',
    selectionCriteria:
      'Use for handbook or incident-policy lookups grounded in internal guidance.',
    description:
      'Handbook and incident policy lookup helpers for grounding summaries in internal guidance.',
    functions: [
      fn('findSnippets')
        .description(
          'Find handbook snippets related to a topic keyword. Accepts topic or query.'
        )
        .arg('topic', f.string('Keyword or topic to search').optional())
        .arg('query', f.string('Alias for topic keyword').optional())
        .arg(
          'maxItems',
          f.number('Maximum number of snippets to return').optional()
        )
        .returns(f.string('Matching handbook snippet').array())
        .handler(async ({ topic, query, maxItems = 3 }) => {
          const needle = (topic ?? query ?? '').trim().toLowerCase();
          if (!needle) {
            return [];
          }
          return handbookSnippets
            .filter((snippet) => snippet.toLowerCase().includes(needle))
            .slice(0, Math.max(1, Math.floor(maxItems)));
        })
        .build(),
    ],
  },
  {
    namespace: 'metrics',
    title: 'Coverage Metrics',
    selectionCriteria:
      'Use for scoring how well a summary covers required operational signals.',
    description:
      'Scoring utilities for quantifying how well a summary covers required operational signals.',
    functions: [
      fn('scoreCoverage')
        .description(
          'Calculate a 0-1 coverage score. Prefer matched/total; also accepts summary/query text.'
        )
        .arg('matched', f.number('Number of matched items').optional())
        .arg('total', f.number('Total number of target items').optional())
        .arg(
          'summary',
          f.string('Summary text to score for policy coverage').optional()
        )
        .arg('query', f.string('Alias for summary text').optional())
        .returns(f.number('Coverage score between 0 and 1'))
        .handler(async ({ matched, total, summary, query }) => {
          const policyNeedles = [
            'severity',
            'mitigation',
            'recovery',
            'postmortem',
            'retry backoff',
          ];
          const numericTotal = Number.isFinite(total) ? (total as number) : 0;

          if (numericTotal <= 0) {
            const text = (summary ?? query ?? '').toLowerCase();
            if (!text) {
              return 0;
            }
            const hitCount = policyNeedles.filter((needle) =>
              text.includes(needle)
            ).length;
            return Math.max(0, Math.min(1, hitCount / policyNeedles.length));
          }
          const ratio = (matched ?? 0) / numericTotal;
          return Math.max(0, Math.min(1, ratio));
        })
        .build(),
    ],
  },
  {
    namespace: 'utils',
    title: 'Formatting Utilities',
    selectionCriteria:
      'Use for output-shaping helpers when the data is already collected.',
    description:
      'Output-shaping helpers for turning collected evidence into markdown-ready text.',
    functions: [
      fn('toBulletList')
        .description(
          'Convert text or an array of lines into a markdown bullet list.'
        )
        .arg(
          'lines',
          f
            .string(
              'Lines to render as bullets (runtime also accepts a single string)'
            )
            .array()
        )
        .returns(f.string('Markdown bullet list'))
        .handler(async ({ lines }: { lines: unknown }) => {
          const collect = (value: unknown): string[] => {
            if (Array.isArray(value)) {
              return value.flatMap((item) => collect(item));
            }
            if (typeof value !== 'string') {
              return [];
            }
            return value
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean);
          };
          const normalized = collect(lines);

          return normalized.map((line) => `- ${line}`).join('\n');
        })
        .build(),
    ],
  },
];

const analyst = agent(
  'context:string, query:string, audience:string -> answer:string, evidence:string[], coverageScore:number, polishedSummary:string',
  {
    agentIdentity: {
      name: 'RLM Discovery Analyst',
      description:
        'Analyzes long context using code execution, dynamic tool discovery, and optional writing refinement.',
      namespace: 'team',
    } as any,
    contextFields: ['context'],
    runtime,
    functions: [
      ...tools,
      {
        namespace: 'team',
        title: 'Team Agents',
        selectionCriteria:
          'Use for specialist agent help with writing or review tasks.',
        description: 'Callable specialist agents available to the executor.',
        functions: [writingCoach.getFunction()],
      },
    ],
    functionDiscovery: true,
    executorOptions: {
      description: [
        'Workflow:',
        '1) Discover modules and functions you need (kb, metrics, utils, team).',
        '2) Use a batched llmQuery([...]) to delegate three child analyses in parallel: severity policy review, mitigation/recovery review, and postmortem/follow-up review. IMPORTANT: pass the incident context to each child via context: { incident: inputs.context }.',
        '3) After the reviews complete, merge findings into a manager-ready draft.',
        '4) Call metrics.scoreCoverage({ matched: <n>, total: <n> }) for coverageScore.',
        '5) Call team.writingCoach with { draft: <summary> } to produce polishedSummary (audience is shared).',
        '6) Use utils.toBulletList with evidence lines for formatting.',
      ].join('\n'),
    },
    maxBatchedLlmQueryConcurrency: 3,
    maxTurns: 12,
    debug: true,
  }
);

const incidentContext = `
Incident: checkout-api / payment gateway degradation

Customer impact:
- 18% of checkout attempts failed for 15 minutes.
- Two enterprise tenants reported duplicate retry emails and delayed confirmations.
- Support tagged the incident as "high urgency" but no formal severity label was recorded.

Timeline:
09:03 - elevated error rate for checkout start.
09:07 - on-call confirmed payment gateway latency spike.
09:09 - retry queue growth observed across three regions.
09:12 - mitigation flag enabled to bypass retry storm.
09:18 - error rate dropped, checkout recovery confirmed.
09:26 - support confirmed new purchases were succeeding again.
09:35 - follow-up item opened for retry backoff tuning.
09:41 - incident channel noted that a postmortem owner was still unassigned.

Operational notes:
- Internal handbook says severity depends on customer impact and duration.
- A mitigation is only complete once user-facing actions recover.
- Postmortems must include a timeline, root cause, and follow-up owners.
- Escalate to the on-call lead if mitigation takes longer than 20 minutes.
- The draft incident note mentions recovery and retry-backoff tuning, but does not name a postmortem owner.
`.trim();

const result = await analyst.forward(llm, {
  context: incidentContext,
  query:
    'Create a manager-ready incident brief. You must run three separate delegated policy reviews for severity, mitigation/recovery, and postmortem/follow-up, then merge those findings into the final summary. Use discovered APIs only (no guessed names), and coverageScore must come from metrics.scoreCoverage.',
  audience: 'engineering managers',
});

console.log('Answer:', result.answer);
console.log('Evidence:', result.evidence);
console.log('Coverage Score:', result.coverageScore);
console.log('Polished Summary:', result.polishedSummary);
