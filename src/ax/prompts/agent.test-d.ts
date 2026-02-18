import {
  agent,
  f,
  s,
  type AxCodeRuntime,
  type AxRLMInlineOutput,
  type AxRLMInput,
} from '../index.js';

// Basic agent with string signature — forward() returns typed output
{
  const a = agent('query:string -> answer:string, score:number', {
    name: 'testAgent',
    description: 'Test agent for type checking',
  });

  type Result = Awaited<ReturnType<typeof a.forward>>;
  const _ok: Result = { answer: 'x', score: 5 };
  // @ts-expect-error missing required field
  const _bad: Result = { answer: 'x' };
}

// Agent with AxSignature from s() — forward() returns typed output
{
  const sig = s('query:string -> answer:string, score:number');
  const a = agent(sig, {
    name: 'testAgent',
    description: 'Test agent for type checking',
  });

  type Result = Awaited<ReturnType<typeof a.forward>>;
  const _ok: Result = { answer: 'x', score: 5 };
}

// Agent with AxSignature from f() fluent builder — forward() returns typed output
{
  const sig = f()
    .input('query', f.string())
    .output('answer', f.string())
    .output('score', f.number())
    .build();
  const a = agent(sig, {
    name: 'testAgent',
    description: 'Test agent for type checking',
  });

  type Result = Awaited<ReturnType<typeof a.forward>>;
  const _ok: Result = { answer: 'x', score: 5 };
  // @ts-expect-error missing required field
  const _bad: Result = { answer: 'x' };
}

// RLM utility types
{
  type IN = { context: string; query: string };
  type OUT = { answer: string; evidence: string[] };

  // AxRLMInput removes context fields and adds contextMetadata
  type RIn = AxRLMInput<IN, 'context'>;
  const _rin: RIn = { query: 'q', contextMetadata: 'meta' };
  // @ts-expect-error context field should be removed
  const _bad: RIn = { context: 'x', query: 'q', contextMetadata: 'meta' };

  // AxRLMInlineOutput makes all outputs optional, adds code field
  type ROut = AxRLMInlineOutput<OUT, 'javascriptCode'>;
  const _rout: ROut = {};
  const _rout2: ROut = {
    answer: 'x',
    evidence: ['y'],
    javascriptCode: 'code',
  };
}

// RLM agent with string signature — setExamples accepts RLM fields
{
  const runtime = {} as AxCodeRuntime;
  const a = agent(
    'context:string, query:string -> answer:string, evidence:string[]',
    {
      name: 'testAgent',
      description: 'Test agent for type checking',
      rlm: {
        mode: 'inline' as const,
        contextFields: ['context'] as const,
        runtime,
      },
    }
  );

  // Should accept original fields
  a.setExamples([{ answer: 'x', evidence: ['y'] }]);

  // Should accept RLM-extended fields
  a.setExamples([
    {
      query: 'q',
      contextMetadata: 'string, 100 chars',
      answer: 'x',
      evidence: ['y'],
      javascriptCode: 'var x = 1',
    },
  ]);

  // forward() still returns the original OUT type
  type Result = Awaited<ReturnType<typeof a.forward>>;
  const _ok: Result = { answer: 'x', evidence: ['y'] };
}

// RLM agent with f() fluent signature — setExamples accepts RLM fields
{
  const runtime = {} as AxCodeRuntime;
  const sig = f()
    .input('context', f.string())
    .input('query', f.string())
    .output('answer', f.string())
    .output('evidence', f.string().array())
    .build();

  const a = agent(sig, {
    name: 'testAgent',
    description: 'Test agent for type checking',
    rlm: {
      mode: 'inline' as const,
      contextFields: ['context'] as const,
      runtime,
    },
  });

  // Should accept RLM-extended fields
  a.setExamples([
    {
      query: 'q',
      contextMetadata: 'string, 100 chars',
      answer: 'x',
      evidence: ['y'],
      javascriptCode: 'var x = 1',
    },
  ]);

  // forward() still returns original OUT
  type Result = Awaited<ReturnType<typeof a.forward>>;
  const _ok: Result = { answer: 'x', evidence: ['y'] };
}

// RLM function mode — output type matches original OUT (no code fields)
{
  const runtime = {} as AxCodeRuntime;
  const a = agent('context:string, query:string -> answer:string', {
    name: 'testAgent',
    description: 'Test agent for type checking',
    rlm: {
      mode: 'function' as const,
      contextFields: ['context'] as const,
      runtime,
    },
  });

  // RLM function mode output is same as original OUT
  a.setExamples([{ answer: 'x' }]);
  a.setExamples([{ query: 'q', contextMetadata: 'meta', answer: 'x' }]);
}
