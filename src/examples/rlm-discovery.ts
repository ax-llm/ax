import {
  AxAIGoogleGeminiModel,
  AxJSRuntime,
  AxJSRuntimePermission,
  type AxFunction,
  agent,
  ai,
} from '@ax-llm/ax';

const llm = ai({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY!,
  config: {
    model: AxAIGoogleGeminiModel.Gemini3FlashLite,
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

const tools: AxFunction[] = [
  {
    name: 'findSnippets',
    namespace: 'kb',
    description:
      'Find handbook snippets related to a topic keyword. Accepts topic or query.',
    parameters: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Keyword or topic to search' },
        query: {
          type: 'string',
          description: 'Alias for topic keyword',
        },
        maxItems: {
          type: 'number',
          description: 'Maximum number of snippets to return',
        },
      },
      required: [],
    },
    returns: {
      type: 'array',
      items: { type: 'string' },
    },
    func: async ({
      topic,
      query,
      maxItems = 3,
    }: {
      topic?: string;
      query?: string;
      maxItems?: number;
    }) => {
      const needle = (topic ?? query ?? '').trim().toLowerCase();
      if (!needle) {
        return [];
      }
      return handbookSnippets
        .filter((snippet) => snippet.toLowerCase().includes(needle))
        .slice(0, Math.max(1, Math.floor(maxItems)));
    },
  },
  {
    name: 'scoreCoverage',
    namespace: 'metrics',
    description:
      'Calculate a 0-1 coverage score. Prefer matched/total; also accepts summary/query text.',
    parameters: {
      type: 'object',
      properties: {
        matched: { type: 'number', description: 'Number of matched items' },
        total: { type: 'number', description: 'Total number of target items' },
        summary: {
          type: 'string',
          description: 'Summary text to score for policy coverage',
        },
        query: {
          type: 'string',
          description: 'Alias for summary text',
        },
      },
      required: [],
    },
    returns: { type: 'number' },
    func: async ({
      matched,
      total,
      summary,
      query,
    }: {
      matched?: number;
      total?: number;
      summary?: string;
      query?: string;
    }) => {
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
    },
  },
  {
    name: 'toBulletList',
    namespace: 'utils',
    description:
      'Convert text or an array of lines into a markdown bullet list.',
    parameters: {
      type: 'object',
      properties: {
        lines: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Lines to render as bullets (runtime also accepts a single string)',
        },
      },
      required: ['lines'],
    },
    returns: { type: 'string' },
    func: async ({ lines }: { lines: unknown }) => {
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
    },
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
    agents: { local: [writingCoach] },
    fields: { shared: ['audience'] },
    functions: { discovery: true, local: tools } as any,
    actorOptions: {
      description: [
        'Mandatory execution order for this demo:',
        '1) Call listModuleFunctions(["team","kb","metrics","utils"]) and log the output.',
        '2) Call getFunctionDefinitions(...) for every callable you will use and log the output.',
        '3) Call kb.findSnippets at least twice using { topic: "severity" } and { topic: "postmortem" }.',
        '4) Call metrics.scoreCoverage and use THAT numeric result for coverageScore. Preferred form: metrics.scoreCoverage({ matched: <n>, total: <n> }).',
        '5) Call team.writingCoach with { draft: <summary> } to produce polishedSummary (audience is shared from parent inputs).',
        '6) Use utils.toBulletList with an array of evidence lines for formatting.',
        'Do not call final(...) before completing all six steps.',
      ].join('\n'),
      thinkingTokenBudget: 'minimal',
    },
    mode: 'simple',
    maxSubAgentCalls: 20,
    maxTurns: 8,
    debug: true,
  }
);

const incidentContext = `
09:03 - elevated error rate for checkout start.
09:07 - on-call confirmed payment gateway latency spike.
09:12 - mitigation flag enabled to bypass retry storm.
09:18 - error rate dropped, checkout recovery confirmed.
09:35 - follow-up item opened for retry backoff tuning.
`.trim();

const result = await analyst.forward(llm, {
  context: incidentContext,
  query:
    'Produce an incident summary with policy-aligned next steps. You must use discovered APIs (not guessed names), and coverageScore must come from metrics.scoreCoverage.',
  audience: 'engineering managers',
});

console.log('Answer:', result.answer);
console.log('Evidence:', result.evidence);
console.log('Coverage Score:', result.coverageScore);
console.log('Polished Summary:', result.polishedSummary);
