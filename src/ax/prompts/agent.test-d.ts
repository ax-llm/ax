import { agent, f, s, type AxCodeRuntime, type AxFunction } from '../index.js';

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

// Agent with trajectoryPruning enabled (deprecated but still valid)
{
  const runtime = {} as AxCodeRuntime;
  const a = agent('context:string, query:string -> answer:string', {
    contextFields: ['context'] as const,
    runtime,
    trajectoryPruning: true,
  });

  type Result = Awaited<ReturnType<typeof a.forward>>;
  const _ok: Result = { answer: 'x' };
}

// Agent with contextManagement — errorPruning
{
  const runtime = {} as AxCodeRuntime;
  const a = agent('context:string, query:string -> answer:string', {
    contextFields: ['context'] as const,
    runtime,
    contextManagement: {
      errorPruning: true,
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

// Agent with contextManagement — all options
{
  const runtime = {} as AxCodeRuntime;
  agent('context:string, query:string -> answer:string', {
    contextFields: ['context'] as const,
    runtime,
    contextManagement: {
      errorPruning: true,
      hindsightEvaluation: true,
      tombstoning: { model: 'fast-model', modelConfig: { temperature: 0.1 } },
      stateInspection: { contextThreshold: 1000 },
      pruneRank: 3,
    },
  });
}

// Agent with contextManagement — tombstoning as boolean
{
  const runtime = {} as AxCodeRuntime;
  agent('context:string, query:string -> answer:string', {
    contextFields: ['context'] as const,
    runtime,
    contextManagement: {
      tombstoning: true,
    },
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
