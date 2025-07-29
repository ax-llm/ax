// Assume the same BuildObject and TypeMap as before...

import type { BuildObject } from '@ax-llm/ax/dsp/sigtypes.js';

// A helper type to trim whitespace from string types
type Trim<S extends string> = S extends ` ${infer T}`
  ? Trim<T>
  : S extends `${infer T} `
    ? Trim<T>
    : S;

// A recursive type to parse a list of fields
type ParseFields<
  S extends string,
  Acc extends readonly any[] = [],
> = S extends `${infer Field},${infer Rest}`
  ? ParseFields<Rest, [...Acc, ParseField<Trim<Field>>]>
  : [...Acc, ParseField<Trim<S>>];

// A type to parse a single "name: type" field
type ParseField<S extends string> = S extends `${infer Name}:${infer Type}`
  ? { name: Trim<Name>; type: Trim<Type> }
  : never;

// The generic function. The IMPLEMENTATION is simple, but the SIGNATURE does the magic.
function genericParse<const T extends string>(signature: T): ParseFields<T> {
  // The runtime implementation just does the work. The type signature provides the magic.
  const fields = signature.split(',').map((part) => {
    const [name, type] = part.trim().split(':');
    return { name: name.trim(), type: type.trim() };
  });
  return fields as any; // We use 'as any' because TS can't verify the complex implementation matches the generic type signature.
}

// --- USAGE ---
const result = genericParse('question: string, context: string');
// Hover over 'result' in your IDE. Its type is inferred perfectly!
// It is: [{ name: "question"; type: "string"; }, { name: "context"; type: "string"; }]

type PowerfulInputType = BuildObject<typeof result>;

const _myPowerfulInput: PowerfulInputType = {
  question: 'How does this work?',
  context: 'With advanced TypeScript types!',
};
