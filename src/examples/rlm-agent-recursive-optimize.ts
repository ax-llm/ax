import { readFile, writeFile } from 'node:fs/promises';

import {
  type AxAgentEvalPrediction,
  type AxAgentEvalTask,
  AxAIGoogleGeminiModel,
  AxGen,
  AxJSRuntime,
  AxOptimizedProgramImpl,
  agent,
  ai,
  f,
  fn,
} from '@ax-llm/ax';

const artifactPath = new URL(
  './rlm-agent-recursive-optimize.json',
  import.meta.url
);
const googleApiKey = process.env.GOOGLE_APIKEY;
const optimizerTrials = Number(process.env.AX_RECURSIVE_GEPA_NUM_TRIALS ?? 3);
const optimizerMinibatchSize = Number(
  process.env.AX_RECURSIVE_GEPA_MINIBATCH_SIZE ?? 3
);
const optimizerEarlyStoppingTrials = Number(
  process.env.AX_RECURSIVE_GEPA_EARLY_STOPPING_TRIALS ?? 2
);
const optimizerMaxMetricCalls = Number(
  process.env.AX_RECURSIVE_GEPA_MAX_METRIC_CALLS ?? 36
);

if (!googleApiKey) {
  console.error('GOOGLE_APIKEY is required');
  process.exit(1);
}

const studentAI = ai({
  name: 'google-gemini',
  apiKey: googleApiKey,
  config: {
    model: AxAIGoogleGeminiModel.Gemini25FlashLite,
    temperature: 0.2,
    maxTokens: 320,
  },
});

const teacherAI = ai({
  name: 'google-gemini',
  apiKey: googleApiKey,
  config: {
    model: AxAIGoogleGeminiModel.Gemini25Pro,
    temperature: 0.2,
    maxTokens: 640,
  },
});

const judgeAI = ai({
  name: 'google-gemini',
  apiKey: googleApiKey,
  config: {
    model: AxAIGoogleGeminiModel.Gemini3Pro,
    temperature: 0,
    maxTokens: 640,
  },
});

const runtime = new AxJSRuntime();

const projects = {
  Atlas: {
    owner: 'Maya',
    blocker: 'Payment retry loop still creates duplicate confirmations.',
    summary:
      'Checkout reliability is improving, but retries still amplify noisy failures.',
    risks: [
      'Duplicate customer confirmations when retries fan out under gateway latency.',
      'Support load spikes when delayed receipts arrive after the purchase already succeeded.',
    ],
    nextMilestone:
      'Ship retry backoff patch and confirm clean receipts in production.',
    nextAction:
      'Ship retry backoff patch and confirm clean receipts in production.',
  },
  Nova: {
    owner: 'Chris',
    blocker: 'CSV import validation rejects some UTF-8 filenames.',
    summary:
      'Launch work is on track, with one import edge case left to close.',
    risks: ['Import failures block self-serve onboarding for a small cohort.'],
    nextMilestone:
      'Release filename-normalization fix and reopen the beta cohort.',
    nextAction:
      'Release filename-normalization fix and reopen the beta cohort.',
  },
} as const;

const people = {
  Maya: { name: 'Maya', email: 'maya@example.com', team: 'Payments' },
  Chris: { name: 'Chris', email: 'chris@example.com', team: 'Growth' },
} as const;

const projectTools = [
  fn('lookupProjectStatus')
    .description(
      'Return the current status snapshot for one project. The result always contains owner, blocker, summary, risks, nextMilestone, and nextAction.'
    )
    .arg(
      'projectName',
      f.string('Canonical project name such as Atlas or Nova')
    )
    .returns(
      f.object({
        owner: f.string('Project owner name'),
        blocker: f.string('Current blocking issue'),
        summary: f.string('Compact project summary'),
        risks: f.string('Key project risk').array(),
        nextMilestone: f.string('Next milestone'),
        nextAction: f.string(
          'Immediate next action; often mirrors the next milestone'
        ),
      })
    )
    .handler(async ({ projectName }) => {
      const key = String(projectName).trim() as keyof typeof projects;
      return projects[key];
    })
    .build(),
  fn('lookupPerson')
    .description(
      'Return contact details for a named owner. Call with { name } and use the returned name, email, and team fields directly.'
    )
    .arg('name', f.string('Owner name'))
    .returns(
      f.object({
        name: f.string('Person name'),
        email: f.string('Email address'),
        team: f.string('Team name'),
      })
    )
    .handler(async ({ name }) => {
      const key = String(name).trim() as keyof typeof people;
      return people[key];
    })
    .build(),
];

const trainTasks: readonly AxAgentEvalTask<{ query: string }>[] = [
  {
    input: {
      query: 'Who owns the Atlas project and what is currently blocking it?',
    },
    criteria:
      'Use the project tools and answer directly. This is a simple factual lookup and should not recurse.',
    expectedActions: ['lookupProjectStatus'],
  },
  {
    input: {
      query:
        'Prepare a concise leadership brief for the Atlas project with the current blocker, the owner contact, and the next action. This broader synthesis should use one focused delegated child analysis after narrowing the tool output in JS.',
    },
    criteria:
      'Look up the Atlas project status, resolve the owner, narrow the payload in JS, then use one recursive child analysis to turn that narrowed evidence into a short leadership-ready brief.',
    expectedActions: ['lookupProjectStatus', 'lookupPerson'],
  },
  {
    input: {
      query: 'What is the next milestone for the Nova project?',
    },
    criteria:
      'Use the project tools and answer directly without recursion or extra synthesis.',
    expectedActions: ['lookupProjectStatus'],
  },
];

const validationTasks: readonly AxAgentEvalTask<{ query: string }>[] = [
  {
    input: {
      query:
        'Draft a manager update for the Nova project that includes the owner, the blocker, and the next milestone. Use recursion only if the broader synthesis genuinely benefits from it.',
    },
    criteria:
      'Look up Nova, resolve the owner, and produce a compact manager update. Prefer shallow execution unless the synthesis clearly needs one delegated child.',
    expectedActions: ['lookupProjectStatus', 'lookupPerson'],
  },
];

const judgeGen = new AxGen<
  {
    taskInput: object;
    criteria: string;
    expectedActions?: string[];
    forbiddenActions?: string[];
    completionType: string;
    clarification?: object;
    finalOutput?: object;
    functionCalls?: object;
    toolErrors?: string[];
    turnCount: number;
    recursiveStats?: object;
    recursiveTrace?: object;
  },
  { score: number }
>(`
  taskInput:json "Structured task input",
  criteria:string "Task-specific success criteria",
  expectedActions?:string[] "Optional actions that should appear in the run",
  forbiddenActions?:string[] "Optional actions that should not appear in the run",
  completionType:string "How the agent completed the run",
  clarification?:json "Clarification payload when the agent asked for more information",
  finalOutput?:json "Final structured output when the run completed normally",
  functionCalls?:json "Observed function-call records",
  toolErrors?:string[] "Observed tool errors",
  turnCount:number "Number of actor turns",
  recursiveStats?:json "Recursive execution statistics",
  recursiveTrace?:json "Recursive trace tree"
  ->
  score:number "Normalized quality score from 0 to 1"
`);
judgeGen.setInstruction(
  [
    'Score the agent run from 0 to 1.',
    'Reward correct factual answers, correct tool use, and following the task criteria.',
    'For simple factual lookups, reward staying shallow and answering directly without recursion.',
    'For broader synthesis tasks, reward at most one focused delegated child analysis after narrowing tool output.',
    'Penalize unnecessary recursion, redundant delegation, missing expected actions, forbidden actions, and tool errors.',
    'Return only the score field.',
  ].join('\n')
);

const trainingAgent = agent(
  'query:string -> answer:string, citedFacts:string[]',
  {
    ai: studentAI,
    contextFields: [],
    runtime,
    mode: 'advanced',
    recursionOptions: {
      maxDepth: 2,
    },
    maxTurns: 6,
    maxSubAgentCalls: 2,
    actorOptions: {
      modelConfig: {
        temperature: 0.2,
        maxTokens: 220,
      },
      description: [
        'For simple factual questions, stay shallow: call the tools, narrow the result in JS, and answer directly without recursion.',
        'In this demo there is exactly one Atlas project and exactly one Nova project. Never ask for project disambiguation or invent multiple Atlas/Nova variants.',
        'Never use llmQuery(...) for direct project lookups like owner, blocker, or next milestone when the tools already provide the answer.',
        'Never simulate tool output or invent missing fields. Use only the exact tool schemas: lookupProjectStatus({ projectName }) returns owner, blocker, summary, risks, nextMilestone, and nextAction; lookupPerson({ name }) returns name, email, and team.',
        'Do not invent ownerId, personId, nextStep, or nextAction-like aliases beyond the exact returned keys.',
        'Return only raw runnable JavaScript. Never prefix code with `javascript:` and never emit multiple code snippets in one turn.',
        'If you inspect anything with console.log(...), emit exactly one console.log call in that turn and then stop.',
        'If you delegate with llmQuery(...), always pass an explicit compact context object. Children only see the passed context and do not see Atlas/Nova globals or earlier tool results unless you include them.',
        'For broader synthesis questions that ask for a brief, recommendation, or next action, narrow the tool output in JS first to exact fields like { owner, ownerEmail, blocker, nextAction } and then use at most one focused llmQuery(...) child analysis.',
        'At terminal depth, answer directly from the available context instead of delegating again.',
      ].join('\n'),
    },
    responderOptions: {
      modelConfig: {
        temperature: 0.2,
        maxTokens: 180,
      },
    },
    functions: { local: projectTools },
  }
);

console.log('Starting recursive GEPA optimization...');
console.log(
  `Using numTrials=${optimizerTrials}, minibatchSize=${optimizerMinibatchSize}, earlyStoppingTrials=${optimizerEarlyStoppingTrials}, maxMetricCalls=${optimizerMaxMetricCalls}`
);
console.log(`Using AxGen judge model=${AxAIGoogleGeminiModel.Gemini3Pro}`);

const optimizationResult = await trainingAgent.optimize(
  {
    train: trainTasks,
    validation: validationTasks,
  },
  {
    studentAI,
    teacherAI,
    target: 'all',
    numTrials: optimizerTrials,
    minibatch: true,
    minibatchSize: optimizerMinibatchSize,
    earlyStoppingTrials: optimizerEarlyStoppingTrials,
    sampleCount: 1,
    seed: 7,
    maxMetricCalls: optimizerMaxMetricCalls,
    metric: async ({ prediction, example }) => {
      const evalPrediction = prediction as AxAgentEvalPrediction<{
        answer: string;
        citedFacts: string[];
      }>;
      const task = example as AxAgentEvalTask<{ query: string }>;

      const judged = await judgeGen.forward(
        judgeAI,
        {
          taskInput: task.input,
          criteria: task.criteria,
          expectedActions: task.expectedActions,
          forbiddenActions: task.forbiddenActions,
          completionType: evalPrediction.completionType,
          clarification: evalPrediction.clarification,
          finalOutput: evalPrediction.output,
          functionCalls: evalPrediction.functionCalls,
          toolErrors: evalPrediction.toolErrors,
          turnCount: evalPrediction.turnCount,
          recursiveStats: evalPrediction.recursiveStats,
          recursiveTrace: evalPrediction.recursiveTrace,
        },
        {
          model: AxAIGoogleGeminiModel.Gemini3Pro,
          modelConfig: { temperature: 0, maxTokens: 160 },
          maxSteps: 1,
        }
      );

      return Math.max(0, Math.min(1, judged.score));
    },
    verbose: true,
    onProgress: (progress) => {
      console.log(
        `round=${progress.round}/${progress.totalRounds} best=${progress.bestScore.toFixed(3)}`
      );
    },
  }
);

if (!optimizationResult.optimizedProgram) {
  throw new Error('No optimized program was produced.');
}

await writeFile(
  artifactPath,
  JSON.stringify(optimizationResult.optimizedProgram, null, 2)
);
console.log(`Saved recursive GEPA artifact to ${artifactPath.pathname}`);
console.log(
  'Recursive-slot artifacts are forward-only. Older Ax versions will not understand these instruction-slot IDs.'
);

const restoredProgram = new AxOptimizedProgramImpl(
  JSON.parse(await readFile(artifactPath, 'utf8'))
);

const optimizedAgent = agent(
  'query:string -> answer:string, citedFacts:string[]',
  {
    ai: studentAI,
    contextFields: [],
    runtime,
    mode: 'advanced',
    recursionOptions: {
      maxDepth: 2,
    },
    maxTurns: 6,
    maxSubAgentCalls: 2,
    actorOptions: {
      modelConfig: {
        temperature: 0.2,
        maxTokens: 220,
      },
      description: [
        'For simple factual questions, stay shallow: call the tools, narrow the result in JS, and answer directly without recursion.',
        'In this demo there is exactly one Atlas project and exactly one Nova project. Never ask for project disambiguation or invent multiple Atlas/Nova variants.',
        'Never use llmQuery(...) for direct project lookups like owner, blocker, or next milestone when the tools already provide the answer.',
        'Never simulate tool output or invent missing fields. Use only the exact tool schemas: lookupProjectStatus({ projectName }) returns owner, blocker, summary, risks, nextMilestone, and nextAction; lookupPerson({ name }) returns name, email, and team.',
        'Do not invent ownerId, personId, nextStep, or nextAction-like aliases beyond the exact returned keys.',
        'Return only raw runnable JavaScript. Never prefix code with `javascript:` and never emit multiple code snippets in one turn.',
        'If you inspect anything with console.log(...), emit exactly one console.log call in that turn and then stop.',
        'If you delegate with llmQuery(...), always pass an explicit compact context object. Children only see the passed context and do not see Atlas/Nova globals or earlier tool results unless you include them.',
        'For broader synthesis questions that ask for a brief, recommendation, or next action, narrow the tool output in JS first to exact fields like { owner, ownerEmail, blocker, nextAction } and then use at most one focused llmQuery(...) child analysis.',
        'At terminal depth, answer directly from the available context instead of delegating again.',
      ].join('\n'),
    },
    responderOptions: {
      modelConfig: {
        temperature: 0.2,
        maxTokens: 180,
      },
    },
    functions: { local: projectTools },
  }
);

optimizedAgent.applyOptimization(restoredProgram);

console.log(
  'Optimized instruction slots:',
  Object.keys(restoredProgram.instructionMap ?? {})
);

const showcase = await optimizedAgent.forward(studentAI, {
  query:
    'Give leadership a concise brief for the Atlas project with the owner contact, the blocker, and the next action.',
});

console.log('Answer:', showcase.answer);
console.log('Cited Facts:', showcase.citedFacts);
