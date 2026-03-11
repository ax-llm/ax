import {
  type AxAgentFunction,
  type AxAgentFunctionGroup,
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
  const _ok: Promise<string> = result;
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

// Agent with contextPolicy — all options
{
  const runtime = {} as AxCodeRuntime;
  agent('context:string, query:string -> answer:string', {
    contextFields: ['context'] as const,
    runtime,
    contextPolicy: {
      preset: 'lean',
      state: {
        summary: true,
        inspect: true,
        inspectThresholdChars: 1000,
        maxEntries: 4,
      },
      checkpoints: {
        enabled: true,
        triggerChars: 900,
      },
      expert: {
        replay: 'adaptive',
        recentFullActions: 2,
        pruneErrors: true,
        rankPruning: { enabled: true, minRank: 3 },
        tombstones: { model: 'fast-model', modelConfig: { temperature: 0.1 } },
      },
    },
  });
}

// Agent with contextPolicy — tombstones as boolean
{
  const runtime = {} as AxCodeRuntime;
  agent('context:string, query:string -> answer:string', {
    contextFields: ['context'] as const,
    runtime,
    contextPolicy: {
      expert: {
        tombstones: true,
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
  ];

  agent('query:string -> answer:string', {
    contextFields: [] as const,
    runtime,
    functions: {
      discovery: true,
      local: groupedFns,
      shared: [agentFns[0]!],
      globallyShared: [agentFns[0]!],
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
