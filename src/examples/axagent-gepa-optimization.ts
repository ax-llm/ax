import {
  type AxAgentEvalTask,
  type AxAgentFunction,
  AxAIGoogleGeminiModel,
  AxJSRuntime,
  type AxOptimizedProgramImpl,
  agent,
  ai,
  axDeserializeOptimizedProgram,
  axSerializeOptimizedProgram,
  f,
  fn,
} from '@ax-llm/ax';

const googleApiKey = process.env.GOOGLE_APIKEY;
const optimizationBudget = 24;

if (!googleApiKey) {
  console.error('GOOGLE_APIKEY is required');
  process.exit(1);
}

type SupportInput = {
  ticket: string;
};

type SupportOutput = {
  answer: string;
  priority: 'low' | 'normal' | 'urgent';
};

type ToolCall = {
  qualifiedName: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  error?: string;
};

type SupportEnvironment = {
  tools: AxAgentFunction[];
  callLog: ToolCall[];
};

type SupportRun = {
  result: SupportOutput;
  toolCalls: string[];
};

const accounts = {
  acme: {
    accountId: 'acct_acme',
    name: 'Acme Manufacturing',
    plan: 'enterprise',
    health: 'red',
    owner: 'Mina',
  },
  orbit: {
    accountId: 'acct_orbit',
    name: 'Orbit Labs',
    plan: 'growth',
    health: 'green',
    owner: 'Sam',
  },
} as const;

const incidents = {
  acct_acme: {
    incidentId: 'inc_acme_17',
    status: 'open',
    impact: 'Checkout API returns intermittent 502 errors for EU traffic.',
    workaround: 'Route EU checkout traffic through the fallback gateway.',
  },
  acct_orbit: {
    incidentId: 'inc_orbit_02',
    status: 'resolved',
    impact: 'A scheduled export was delayed by 9 minutes.',
    workaround: 'No action needed; export has completed.',
  },
} as const;

function createSupportEnvironment(): SupportEnvironment {
  const callLog: ToolCall[] = [];
  const accountEntries = Object.values(accounts);
  const normalizeAlias = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  const resolveAccount = (raw: unknown) => {
    const value = String(raw ?? '')
      .trim()
      .toLowerCase();
    const normalizedValue = normalizeAlias(value);
    if (!value) return undefined;

    const bySlug = accounts[value as keyof typeof accounts];
    if (bySlug) return bySlug;

    const byName = accountEntries.find(
      (account) => account.name.toLowerCase() === value
    );
    if (byName) return byName;

    return accountEntries.find((account) =>
      [
        account.accountId.toLowerCase(),
        account.name.toLowerCase(),
        normalizeAlias(account.name),
      ].some(
        (alias) => alias === value || normalizeAlias(alias) === normalizedValue
      )
    );
  };

  const record = async <T>(
    qualifiedName: string,
    args: Record<string, unknown>,
    run: () => Promise<T>
  ): Promise<T> => {
    try {
      const result = await run();
      callLog.push({ qualifiedName, arguments: args, result });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      callLog.push({ qualifiedName, arguments: args, error: message });
      throw error;
    }
  };

  const tools = [
    fn('lookupAccount')
      .namespace('support')
      .description(
        'Look up an account by customer slug, account name, or accountId. Returns accountId, name, plan, health, and owner.'
      )
      .arg(
        'slug',
        f.string(
          'Lowercase customer slug, exact account name, or accountId, such as acme, Acme Manufacturing, or acct_acme'
        )
      )
      .returns(
        f.object({
          accountId: f.string('Stable account identifier'),
          name: f.string('Customer display name'),
          plan: f.string('Customer plan'),
          health: f.string('Current account health'),
          owner: f.string('Customer owner name'),
        })
      )
      .handler(async ({ slug }) =>
        record('support.lookupAccount', { slug }, async () => {
          const account = resolveAccount(slug);
          if (!account) throw new Error(`Unknown account: ${slug}`);
          return account;
        })
      )
      .build(),
    fn('lookupIncident')
      .namespace('support')
      .description(
        'Look up the latest incident by accountId. Returns incident status, impact, and workaround.'
      )
      .arg(
        'accountId',
        f.string('Account identifier returned by lookupAccount')
      )
      .returns(
        f.object({
          incidentId: f.string('Incident identifier'),
          status: f.string('Incident status'),
          impact: f.string('Customer-facing impact'),
          workaround: f.string('Current workaround or next step'),
        })
      )
      .handler(async ({ accountId }) =>
        record('support.lookupIncident', { accountId }, async () => {
          const key = String(accountId).trim() as keyof typeof incidents;
          const incident = incidents[key];
          if (!incident) throw new Error(`Unknown accountId: ${accountId}`);
          return incident;
        })
      )
      .build(),
  ];

  return { tools, callLog };
}

const studentAI = ai({
  name: 'google-gemini',
  apiKey: googleApiKey,
  config: {
    model: AxAIGoogleGeminiModel.Gemini35Flash,
    temperature: 0.2,
    maxTokens: 700,
  },
});

const teacherAI = ai({
  name: 'google-gemini',
  apiKey: googleApiKey,
  config: {
    model: AxAIGoogleGeminiModel.Gemini3Pro,
    temperature: 0.3,
    maxTokens: 700,
  },
});

// docs:start agent-optimization
function buildSupportAgent(env: SupportEnvironment) {
  return agent(
    'ticket:string -> answer:string, priority:class "low, normal, urgent"',
    {
      ai: studentAI,
      judgeAI: teacherAI,
      runtime: new AxJSRuntime(),
      contextFields: [],
      functions: env.tools,
      maxTurns: 5,
      judgeOptions: {
        description: [
          'Reward runs that use the support tools before answering factual account or incident questions.',
          'Penalize invented facts, missing workaround details, and missing escalation guidance.',
          'Be strict about account and incident questions that skip tool calls.',
        ].join('\n'),
      },
      executorOptions: {
        description: [
          'Use the support tools before answering account or incident questions.',
          'First call support.lookupAccount({ slug }) to get accountId; then call support.lookupIncident({ accountId }) when incident details are needed.',
          'Do not invent accountId values, incident status, impact, workaround, owner, or plan.',
          'For urgent production-impacting incidents, set priority to urgent and include the current workaround.',
          'Always finish by calling final(answer, { priority }).',
          'Return raw runnable JavaScript only; do not include markdown fences, explanations, or prose around code.',
        ].join('\n'),
        thinkingTokenBudget: 'none',
        showThoughts: false,
      },
      responderOptions: {
        description:
          'Write a concise support response using only facts returned by the actor.',
      },
    }
  );
}

const optimizationTasks: readonly AxAgentEvalTask<SupportInput>[] = [
  {
    id: 'acme-incident',
    input: {
      ticket:
        'Acme says EU checkout is failing. Identify the account, current incident impact, workaround, owner, and priority.',
    },
    criteria:
      'Look up Acme, then the incident by returned accountId. Mark as urgent, mention EU checkout 502s, fallback gateway workaround, and owner Mina.',
    expectedOutput: {
      priority: 'urgent',
    },
    expectedActions: ['support.lookupAccount', 'support.lookupIncident'],
  },
  {
    id: 'orbit-status',
    input: {
      ticket:
        'Orbit asks whether the latest export incident still needs action. Include the current status and priority.',
    },
    criteria:
      'Look up Orbit and its incident. Say the incident is resolved, no action is needed, and avoid urgent priority.',
    expectedOutput: {
      priority: 'normal',
    },
    expectedActions: ['support.lookupAccount', 'support.lookupIncident'],
  },
  {
    id: 'acme-owner',
    input: {
      ticket: 'Who owns Acme and what plan are they on?',
    },
    criteria:
      'Only account details are needed. Look up Acme and answer owner Mina with enterprise plan. Do not invent incident facts.',
    expectedOutput: {
      priority: 'normal',
    },
    expectedActions: ['support.lookupAccount'],
    forbiddenActions: ['support.lookupIncident'],
  },
];

const heldOutTask: AxAgentEvalTask<SupportInput> = {
  id: 'acme-workaround',
  input: {
    ticket:
      'A support lead needs the current workaround for Acme Manufacturing and whether this should be escalated.',
  },
  criteria:
    'Use account then incident tools. Include the fallback gateway workaround and urgent escalation guidance.',
  expectedOutput: {
    priority: 'urgent',
  },
  expectedActions: ['support.lookupAccount', 'support.lookupIncident'],
};

function scoreHeldOutRun(run: SupportRun) {
  const answer = run.result.answer.toLowerCase();
  const toolCalls = new Set(run.toolCalls);
  let score = 0;

  if (run.result.priority === 'urgent') score += 0.25;
  if (toolCalls.has('support.lookupAccount')) score += 0.25;
  if (toolCalls.has('support.lookupIncident')) score += 0.25;
  if (
    answer.includes('fallback gateway') ||
    answer.includes('route eu checkout traffic')
  ) {
    score += 0.25;
  }

  return score;
}

async function forwardHeldOut(
  optimizedProgram?: AxOptimizedProgramImpl
): Promise<SupportRun> {
  const env = createSupportEnvironment();
  const assistant = buildSupportAgent(env);
  if (optimizedProgram) {
    assistant.applyOptimization(optimizedProgram);
  }

  const result = await assistant.forward(studentAI, heldOutTask.input);
  return {
    result,
    toolCalls: env.callLog.map((call) => call.qualifiedName),
  };
}

function summarizeRun(run: SupportRun) {
  return {
    answer: run.result.answer,
    priority: run.result.priority,
    toolCalls: run.toolCalls,
    score: scoreHeldOutRun(run).toFixed(2),
  };
}

const baselineRun = await forwardHeldOut();
console.log('Baseline:', summarizeRun(baselineRun));

const trainingEnv = createSupportEnvironment();
const trainingAgent = buildSupportAgent(trainingEnv);
const optimizationResult = await trainingAgent.optimize(optimizationTasks, {
  bootstrap: true,
  maxMetricCalls: optimizationBudget,
});

if (!optimizationResult.optimizedProgram) {
  throw new Error('Agent optimization did not produce an optimized program.');
}

const savedArtifact = axSerializeOptimizedProgram(
  optimizationResult.optimizedProgram
);
const candidateProgram = axDeserializeOptimizedProgram(savedArtifact);
const optimizedRun = await forwardHeldOut(candidateProgram);
// docs:end agent-optimization

if (scoreHeldOutRun(optimizedRun) < scoreHeldOutRun(baselineRun)) {
  throw new Error(
    'Optimization produced a worse held-out run. Artifact not saved; rerun with a larger metric budget if needed.'
  );
}

const restoredRun = await forwardHeldOut(
  axDeserializeOptimizedProgram(savedArtifact)
);
console.log('Optimized:', summarizeRun(restoredRun));
console.log('Artifact ready for storage:', Object.keys(savedArtifact));
