// Compile-time assertion helpers for the type tests gated by
// `npm run test:type-tests` (tsc -p tsconfig.typetests.json). Import these from
// `*.test-d.ts` files (and vitest files that carry type-level witnesses) so all
// type tests share one definition of type equality.

/**
 * Exact type equality, including optionality and readonly-ness of properties.
 * The double-conditional trick makes the comparison non-distributive.
 */
export type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <
  T,
>() => T extends B ? 1 : 2
  ? true
  : false;

/** Compile-time witness: `type _ok = Expect<Equal<A, B>>` fails when false. */
export type Expect<T extends true> = T;

/**
 * Signature field inference (BuildObject) produces intersections of mapped
 * types; flatten one level so Equal can compare against plain object literals.
 */
export type Flatten<T> = { [K in keyof T]: T[K] };
