import {
  AxAgentClarificationError,
  type AxAgentEvalPrediction,
  type AxAgentFunction,
  type AxAgentFunctionGroup,
  type AxAgentJudgeOutput,
  type AxAgentState,
  type AxAgentTestResult,
  type AxCodeRuntime,
  type AxFunction,
  agent,
  f,
  s,
} from '../index.js';

// Basic agent with string signature — forward() returns typed output
{
  const runtime = {} as AxCodeRuntime;
  const a = agent('query:string -> answer:string, score:number', {
    contextFields: [] as const,
    runtime,
  });

  type Result = Awaited<ReturnType<typeof a.forward>>;
  const _ok: Result = { answer: 'x', score: 5 };
  // @ts-expect-error missing required field
  const _bad: Result = { answer: 'x' };
}

// Agent with recursionOptions and maxDepth
{
  const runtime = {} as AxCodeRuntime;
  const a = agent('query:string -> answer:string', {
    contextFields: [] as const,
    runtime,
    recursionOptions: {
      model: 'tiny-model',
      maxDepth: 3,
      timeout: 1_000,
    },
  });

  type Result = Awaited<ReturnType<typeof a.forward>>;
  const _ok: Result = { answer: 'x' };
}

// Agent test() helper returns formatted runtime output
{
  const runtime = {} as AxCodeRuntime;
  const a = agent('query:string -> answer:string', {
    contextFields: ['query'] as const,
    runtime,
  });

  const result = a.test('console.log(query)', { query: 'hello' });
  const _ok: Promise<AxAgentTestResult> = result;
}

// Agent state round-tripping is part of the public surface
{
  const runtime = {} as AxCodeRuntime;
  const a = agent('query:string -> answer:string', {
    contextFields: [] as const,
    runtime,
  });

  const state = a.getState();
  const _ok: AxAgentState | undefined = state;
  a.setState(state);
}

// Clarification errors expose both question and structured payload
{
  const err = new AxAgentClarificationError({
    question: 'Which route should I use?',
    type: 'multiple_choice',
    choices: ['Fastest', 'Scenic'],
  });

  const _question: string = err.question;
  const _payloadQuestion: string = err.clarification.question;
  const _state: AxAgentState | undefined = err.getState();
}

// Agent runtimes may optionally provide native global inspection
{
  const runtime: AxCodeRuntime = {
    getUsageInstructions: () => '',
    createSession() {
      return {
        execute: async () => 'ok',
        inspectGlobals: async () => '{"version":1,"entries":[]}',
        snapshotGlobals: async () => ({
          version: 1 as const,
          entries: [],
          bindings: {},
        }),
        patchGlobals: async () => {},
        close: () => {},
      };
    },
  };

  agent('query:string -> answer:string', {
    contextFields: [] as const,
    runtime,
  });
}

// Agent test() returns completion payloads for final()/askClarification()
{
  const runtime = {} as AxCodeRuntime;
  const a = agent('query:string -> answer:string', {
    contextFields: ['query'] as const,
    runtime,
  });

  const result = a.test('final(query)', { query: 'hello' });
  const _ok: Promise<AxAgentTestResult> = result;
}

// Host-side protocol includes internal guideAgent() for handler-only redirects
{
  const protocol = {} as import('../ai/types.js').AxAgentCompletionProtocol;
  protocol.guideAgent('Use the safer path');
}

// Agent test() should enforce typed inputs
{
  const runtime = {} as AxCodeRuntime;
  const a = agent('query:string, count:number -> answer:string', {
    contextFields: ['query'] as const,
    runtime,
  });

  a.test('console.log(query)', { query: 'hello', count: 1 });

  a.test('console.log("no values")');

  // @ts-expect-error invalid input type
  a.test('console.log(query)', { query: 123 });
}

// recursionOptions.maxDepth should be numeric
{
  const runtime = {} as AxCodeRuntime;
  // @ts-expect-error maxDepth must be a number
  agent('query:string -> answer:string', {
    contextFields: [] as const,
    runtime,
    recursionOptions: {
      maxDepth: '3',
    },
  });
}

// Agent with contextPolicy preset
{
  const runtime = {} as AxCodeRuntime;
  const a = agent('context:string, query:string -> answer:string', {
    contextFields: ['context'] as const,
    runtime,
    contextPolicy: {
      preset: 'adaptive',
    },
  });

  type Result = Awaited<ReturnType<typeof a.forward>>;
  const _ok: Result = { answer: 'x' };
}

// Agent optimize() should accept built-in judge options and task datasets
{
  const runtime = {} as AxCodeRuntime;
  const judgeAI = {} as any;
  const a = agent('query:string -> answer:string', {
    contextFields: [] as const,
    runtime,
    judgeAI,
    judgeOptions: {
      model: 'judge-model',
      description: 'Be strict about tool use.',
      randomizeOrder: false,
    },
  });

  const optimizePromise = a.optimize([
    {
      input: { query: 'Send an email to Jim' },
      criteria: 'Use the right email tool.',
      expectedActions: ['email.sendEmail'],
    },
  ]);

  const _ok: Promise<Awaited<ReturnType<typeof a.optimize>>> = optimizePromise;

  a.optimize(
    {
      train: [
        {
          input: { query: 'Set up a meeting' },
          criteria: 'Schedule the meeting correctly.',
        },
      ],
      validation: [
        {
          input: { query: 'What is on my calendar today?' },
          criteria: 'Use the calendar tool before answering.',
          forbiddenActions: ['email.sendEmail'],
        },
      ],
    },
    {
      target: ['root.actor'] as const,
      apply: false,
      verbose: true,
      debugOptimizer: true,
      optimizerLogger: () => {},
      onProgress: () => {},
      onEarlyStop: () => {},
      judgeAI,
      judgeOptions: { model: 'override-judge-model' },
    }
  );
}

// Agent optimize() eval predictions discriminate final vs clarification outcomes
{
  const prediction = {} as AxAgentEvalPrediction<{ answer: string }>;

  if (prediction.completionType === 'final') {
    const _answer: string = prediction.output.answer;
  } else {
    const _question: string = prediction.clarification.question;
  }
}

// Agent eval/judge fixtures may omit guidanceLog for compatibility
{
  const finalPrediction: AxAgentEvalPrediction<{ answer: string }> = {
    completionType: 'final',
    output: { answer: 'ok' },
    actionLog: 'ran actions',
    functionCalls: [],
    toolErrors: [],
    turnCount: 1,
  };

  const judgeOutput: AxAgentJudgeOutput = {
    completionType: 'final',
    finalOutput: { answer: 'ok' },
    actionLog: 'ran actions',
    functionCalls: [],
    toolErrors: [],
    turnCount: 1,
    usage: [],
  };

  const _okPrediction: AxAgentEvalPrediction<{ answer: string }> =
    finalPrediction;
  const _okJudgeOutput: AxAgentJudgeOutput = judgeOutput;
}

// Agent with object context field config
{
  const runtime = {} as AxCodeRuntime;
  agent('context:string, query:string -> answer:string', {
    contextFields: [{ field: 'context', promptMaxChars: 1200 }] as const,
    runtime,
  });
}

// Agent with mixed context field config
{
  const runtime = {} as AxCodeRuntime;
  agent('context:string, notes:string, query:string -> answer:string', {
    contextFields: [
      'context',
      { field: 'notes', promptMaxChars: 900 },
    ] as const,
    runtime,
  });
}

// actorModelPolicy should accept namespace-triggered routing
{
  const runtime = {} as AxCodeRuntime;
  agent('query:string -> answer:string', {
    contextFields: [] as const,
    runtime,
    actorModelPolicy: [
      {
        model: 'actor-db',
        namespaces: ['db'],
      },
    ],
  });
}

// Agent actorTurnCallback exposes raw result plus formatted output
{
  const runtime = {} as AxCodeRuntime;
  agent('query:string -> answer:string', {
    contextFields: [] as const,
    runtime,
    actorTurnCallback: async (turn) => {
      const _turn: number = turn.turn;
      const _code: string = turn.code;
      const _result: unknown = turn.result;
      const _output: string = turn.output;
      const _isError: boolean = turn.isError;
      const _thought: string | undefined = turn.thought;
      const _actorResult: Record<string, unknown> = turn.actorResult;
    },
  });
}

// Agent with truncated prompt context config
{
  const runtime = {} as AxCodeRuntime;
  agent('chatHistory:string, query:string -> answer:string', {
    contextFields: [
      {
        field: 'chatHistory',
        keepInPromptChars: 500,
        reverseTruncate: true,
      },
    ] as const,
    runtime,
  });
}

// Agent with top-level summarizerOptions
{
  const runtime = {} as AxCodeRuntime;
  agent('context:string, query:string -> answer:string', {
    contextFields: ['context'] as const,
    runtime,
    maxRuntimeChars: 3000,
    summarizerOptions: {
      model: 'summary-model',
      modelConfig: { temperature: 0.2 },
    },
    contextPolicy: {
      preset: 'lean',
      budget: 'compact',
    },
  });
}

// Nested contextPolicy.summarizerOptions should fail
{
  const runtime = {} as AxCodeRuntime;
  // @ts-expect-error contextPolicy.summarizerOptions moved to top-level summarizerOptions
  agent('context:string, query:string -> answer:string', {
    contextFields: ['context'] as const,
    runtime,
    contextPolicy: {
      preset: 'checkpointed',
      summarizerOptions: {
        model: 'summary-model',
      },
    },
  });
}

// Removed contextManagement API should fail
{
  const runtime = {} as AxCodeRuntime;
  // @ts-expect-error contextManagement was removed
  agent('context:string, query:string -> answer:string', {
    contextFields: ['context'] as const,
    runtime,
    contextManagement: {
      errorPruning: true,
    },
  });
}

// Removed trajectoryPruning API should fail
{
  const runtime = {} as AxCodeRuntime;
  // @ts-expect-error trajectoryPruning was removed
  agent('context:string, query:string -> answer:string', {
    contextFields: ['context'] as const,
    runtime,
    trajectoryPruning: true,
  });
}

// Agent with AxSignature from s() — forward() returns typed output
{
  const runtime = {} as AxCodeRuntime;
  const sig = s('query:string -> answer:string, score:number');
  const a = agent(sig, {
    contextFields: [] as const,
    runtime,
  });

  type Result = Awaited<ReturnType<typeof a.forward>>;
  const _ok: Result = { answer: 'x', score: 5 };
}

// Agent with AxSignature from f() fluent builder — forward() returns typed output
{
  const runtime = {} as AxCodeRuntime;
  const sig = f()
    .input('query', f.string())
    .output('answer', f.string())
    .output('score', f.number())
    .build();
  const a = agent(sig, {
    contextFields: [] as const,
    runtime,
  });

  type Result = Awaited<ReturnType<typeof a.forward>>;
  const _ok: Result = { answer: 'x', score: 5 };
  // @ts-expect-error missing required field
  const _bad: Result = { answer: 'x' };
}

// RLM agent with context fields — forward() returns original OUT type
{
  const runtime = {} as AxCodeRuntime;
  const a = agent(
    'context:string, query:string -> answer:string, evidence:string[]',
    {
      contextFields: ['context'] as const,
      runtime,
    }
  );

  // forward() returns the original OUT type
  type Result = Awaited<ReturnType<typeof a.forward>>;
  const _ok: Result = { answer: 'x', evidence: ['y'] };
}

// Agent with f() fluent builder and context fields
{
  const runtime = {} as AxCodeRuntime;
  const sig = f()
    .input('context', f.string())
    .input('query', f.string())
    .output('answer', f.string())
    .output('evidence', f.string().array())
    .build();

  const a = agent(sig, {
    contextFields: ['context'] as const,
    runtime,
  });

  // forward() returns original OUT
  type Result = Awaited<ReturnType<typeof a.forward>>;
  const _ok: Result = { answer: 'x', evidence: ['y'] };
}

// setDemos — type-safe programId constraints
{
  const runtime = {} as AxCodeRuntime;
  const a = agent('query:string -> answer:string', {
    contextFields: [] as const,
    runtime,
  });

  // Valid: 'actor' and 'responder' are known children
  a.setDemos([{ programId: 'root.actor', traces: [] }]);
  a.setDemos([{ programId: 'root.responder', traces: [] }]);
  a.setDemos([{ programId: 'qa.actor', traces: [] }]);
  a.setDemos([{ programId: 'nested.sub.actor', traces: [] }]);

  // @ts-expect-error typo in child name
  a.setDemos([{ programId: 'root.actr', traces: [] }]);
  // @ts-expect-error unknown child name
  a.setDemos([{ programId: 'root.predictor', traces: [] }]);
}

// AxFunction output schema should be optional
{
  const fnWithoutReturns: AxFunction = {
    name: 'lookupUser',
    description: 'Lookup a user by id',
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
      },
      required: ['userId'],
    },
    async func(args) {
      return { userId: (args as { userId: string }).userId };
    },
  };

  const fnWithReturns: AxFunction = {
    ...fnWithoutReturns,
    returns: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
      },
      required: ['userId'],
    },
  };

  const _ok = [fnWithoutReturns, fnWithReturns];
  void _ok;
}

// AxAgent grouped function modules should be accepted without changing AxFunction
{
  const runtime = {} as AxCodeRuntime;

  const groupedFns: AxAgentFunctionGroup[] = [
    {
      namespace: 'db',
      title: 'Database Tools',
      selectionCriteria: 'Use for schedule or availability lookups',
      description: 'Schedule lookup helpers',
      functions: [
        {
          name: 'lookupSchedule',
          description: 'Lookup schedule data',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Query text' },
            },
            required: ['query'],
          },
          examples: [
            {
              title: 'Simple lookup',
              code: 'await db.lookupSchedule({ query: "alex" });',
            },
          ],
          async func() {
            return [];
          },
        },
      ],
    },
  ];

  const agentFns: AxAgentFunction[] = [
    {
      name: 'lookupSchedule',
      description: 'Lookup schedule data',
      namespace: 'db',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Query text' },
        },
        required: ['query'],
      },
      examples: [
        {
          title: 'Simple lookup',
          code: 'await db.lookupSchedule({ query: "alex" });',
        },
      ],
      async func() {
        return [];
      },
    },
    {
      name: 'lookupOpenSlots',
      namespace: 'db',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Query text' },
        },
        required: ['query'],
      },
      async func() {
        return [];
      },
    },
  ];

  const optionalGroupedFns: AxAgentFunctionGroup[] = [
    {
      namespace: 'kb',
      title: 'Knowledge Base',
      functions: [
        {
          name: 'lookupDocs',
          parameters: {
            type: 'object',
            properties: {
              topic: { type: 'string', description: 'Topic text' },
            },
            required: ['topic'],
          },
          async func() {
            return [];
          },
        },
      ],
    },
  ];

  agent('query:string -> answer:string', {
    contextFields: [] as const,
    runtime,
    functions: {
      discovery: true,
      local: [...groupedFns, ...optionalGroupedFns],
      shared: [agentFns[0]!],
      globallyShared: [agentFns[1]!],
    },
  });
}

// grouped function modules should reject inner namespace declarations
{
  const runtime = {} as AxCodeRuntime;
  agent('query:string -> answer:string', {
    contextFields: [] as const,
    runtime,
    functions: {
      local: [
        {
          namespace: 'db',
          title: 'Database Tools',
          selectionCriteria: 'Use for schedule lookups',
          description: 'Schedule lookup helpers',
          functions: [
            {
              name: 'lookupSchedule',
              description: 'Lookup schedule data',
              parameters: {
                type: 'object',
                properties: {
                  query: { type: 'string', description: 'Query text' },
                },
                required: ['query'],
              },
              // @ts-expect-error grouped functions must not define namespace
              namespace: 'db',
              async func() {
                return [];
              },
            },
          ],
        },
      ],
    },
  });
}

// inputUpdateCallback should infer callback input and patch output from signature inputs
{
  const runtime = {} as AxCodeRuntime;
  agent('query:string, count:number -> answer:string', {
    contextFields: [] as const,
    runtime,
    inputUpdateCallback: (currentInputs) => {
      const _query: string = currentInputs.query;
      const _count: number = currentInputs.count;
      void [_query, _count];
      return { query: _query, count: _count + 1 };
    },
  });
}

// inputUpdateCallback should allow undefined (no-op)
{
  const runtime = {} as AxCodeRuntime;
  agent('query:string -> answer:string', {
    contextFields: [] as const,
    runtime,
    inputUpdateCallback: (currentInputs) => {
      if (currentInputs.query.length > 0) {
        return undefined;
      }
      return { query: 'fallback' };
    },
  });
}

// inputUpdateCallback patch should reject unknown keys
{
  const runtime = {} as AxCodeRuntime;
  // @ts-expect-error unknown key is not part of signature inputs
  agent('query:string -> answer:string', {
    contextFields: [] as const,
    runtime,
    inputUpdateCallback: () => ({ unknownKey: 'x' }),
  });
}

// namespaces should no longer be accepted
{
  const runtime = {} as AxCodeRuntime;
  // @ts-expect-error namespaces was removed in favor of grouped function modules
  agent('query:string -> answer:string', {
    contextFields: [] as const,
    runtime,
    namespaces: [],
  });
}

// agentIdentity.namespace should be accepted and normalized at runtime
{
  const runtime = {} as AxCodeRuntime;
  agent('query:string -> answer:string', {
    contextFields: [] as const,
    runtime,
    agentIdentity: {
      name: 'Parent Agent',
      description: 'Parent',
      namespace: 'Team Namespace',
    },
  });
}

// agentIdentity.namespace should reject non-string values
{
  const runtime = {} as AxCodeRuntime;
  // @ts-expect-error namespace must be a string
  agent('query:string -> answer:string', {
    contextFields: [] as const,
    runtime,
    agentIdentity: {
      name: 'Parent Agent',
      description: 'Parent',
      namespace: 123,
    },
  });
}

// functions.discovery should accept boolean values
{
  const runtime = {} as AxCodeRuntime;
  agent('query:string -> answer:string', {
    contextFields: [] as const,
    runtime,
    functions: { discovery: true, local: [] },
  });
}

// functions.discovery should reject non-boolean values
{
  const runtime = {} as AxCodeRuntime;
  // @ts-expect-error discovery must be a boolean
  agent('query:string -> answer:string', {
    contextFields: [] as const,
    runtime,
    functions: { discovery: 'yes', local: [] },
  });
}

// contextPolicy.pruneUsedDocs was removed
{
  const runtime = {} as AxCodeRuntime;
  // @ts-expect-error pruneUsedDocs no longer exists
  agent('query:string -> answer:string', {
    contextFields: [] as const,
    runtime,
    contextPolicy: { pruneUsedDocs: true },
  });
}
