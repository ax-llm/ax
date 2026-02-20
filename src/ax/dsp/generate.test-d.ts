import { ax, AxGen, f, s } from '../index.js';

// Default thought key should be `thought?: string`
{
  const gen = ax('q:string -> a:string');
  type _Check1 = Parameters<typeof gen.forward>[1] extends { q: string }
    ? true
    : never;
  // Result should include thought?: string by default
  type Result = Awaited<ReturnType<typeof gen.forward>>;
  // Assignability check: object with a and thought is OK
  const _ok: Result = { a: 'x', thought: 'y' };
  // Optional: object without thought is also OK
  const _ok2: Result = { a: 'x' };
  // Wrong key should fail
  // @ts-expect-error wrong optional key
  const _bad: Result = { a: 'x', reasoning: 'y' };
}

// Custom thought key should be reflected when literal is provided
{
  const gen = ax('q:string -> a:string', {
    thoughtFieldName: 'reasoning' as const,
  });
  type Result = Awaited<ReturnType<typeof gen.forward>>;
  const _ok: Result = { a: 'x', reasoning: 'y' };
  const _ok2: Result = { a: 'x' };
  // @ts-expect-error default key not allowed when custom provided
  const _bad: Result = { a: 'x', thought: 'y' };
}

// Works with AxSignature instances too
{
  const sig = s('inp:string -> out:string');
  const gen = ax(sig, { thoughtFieldName: 'meta' as const });
  type Result = Awaited<ReturnType<typeof gen.forward>>;
  const _ok: Result = { out: 'x', meta: 'y' };
  const _ok2: Result = { out: 'x' };
  // @ts-expect-error default key not allowed
  const _bad: Result = { out: 'x', thought: 'z' };
}

// addFieldProcessor narrows value type per field
{
  const gen = ax('q:string -> answer:string, score:number');
  gen.addFieldProcessor('answer', (value) => {
    const _check: string = value; // value should be string
    return value;
  });
  gen.addFieldProcessor('score', (value) => {
    const _check: number = value; // value should be number
    return value;
  });
}

// Constructor preserves types from string signature via s()
{
  const sig = s('q:string -> a:string');
  const gen = new AxGen(sig);
  type Result = Awaited<ReturnType<typeof gen.forward>>;
  const _ok: Result = { a: 'x' };
}

// Constructor preserves types from fluent API via f()
{
  const sig = f()
    .input('question', f.string())
    .output('answer', f.string())
    .output('score', f.number())
    .build();
  const gen = new AxGen(sig);
  type Result = Awaited<ReturnType<typeof gen.forward>>;
  const _ok: Result = { answer: 'x', score: 5 };
  // @ts-expect-error missing required field
  const _bad: Result = { answer: 'x' };
}
