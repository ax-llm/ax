import { describe, expect, it } from 'vitest';
import type { ParseSignature } from './sigtypes.js';
import { s } from './template.js';

// Compile-time assertions for the extended signature grammar. These run under
// `tsc --noEmit` (part of `npm test`), unlike the tsd-based *.test-d.ts files
// which are excluded from the type-check and only run via `npm run
// typecheck:tsd`.

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Expect<T extends true> = T;
// BuildObject produces an intersection of required and optional mapped types;
// flatten it so Equal can compare against plain object literals.
type Flatten<T> = { [K in keyof T]: T[K] };

// --- modifier bags are skipped for inference -------------------------------
type BagSig =
  ParseSignature<'userAge:number(min 0, max 120), contactEmail:string(format email, cache) -> userName:string(pattern "^[a-z_]+$" "lowercase")'>;
type _bagInputs = Expect<
  Equal<Flatten<BagSig['inputs']>, { userAge: number; contactEmail: string }>
>;
type _bagOutputs = Expect<
  Equal<Flatten<BagSig['outputs']>, { userName: string }>
>;

// --- code language, item descriptions, bag-before-array binding ------------
type CodeSig =
  ParseSignature<'codeSnippet:code(python), tagList:string(item "a tag")[] -> scoreList:number(min 0, max 10)[]'>;
type _codeInputs = Expect<
  Equal<Flatten<CodeSig['inputs']>, { codeSnippet: string; tagList: string[] }>
>;
type _codeOutputs = Expect<
  Equal<Flatten<CodeSig['outputs']>, { scoreList: number[] }>
>;

// --- nested objects, optional keys, nested class unions, nested arrays -----
type ObjectSig =
  ParseSignature<'userQuestion:string -> profileList:object{ fullName:string, userAge?:number(min 0), priority:class "high, low", nested:object{ deepValue:string }[] }[] "profiles"'>;
type _objectOutput = Expect<
  Equal<
    ObjectSig['outputs']['profileList'],
    {
      fullName: string;
      userAge?: number;
      priority: 'high' | 'low';
      nested: { deepValue: string }[];
    }[]
  >
>;

// --- descriptions with commas next to braces stay one field ----------------
type CommaSig =
  ParseSignature<'orderInfo:object{ sku:string "the item, verbatim", qty:number } "order, as placed" -> replyText:string'>;
type _commaInput = Expect<
  Equal<
    Flatten<CommaSig['inputs']>,
    { orderInfo: { sku: string; qty: number } }
  >
>;

// --- budget case: three nesting levels with mixed features -----------------
type BudgetSig =
  ParseSignature<'requestText:string(min 1, max 2000), contextText:string(cache) -> reportData:object{ headline:string, sections:object{ title:string, bulletPoints:string[], rating:class "good, bad", details:object{ note:string, score:number(min 0, max 10) } }[], tags:string[], approved:boolean }, summaryText:string(max 500)'>;
type _budgetLeaf = Expect<Equal<ObjectLeaf, { note: string; score: number }>>;
type ObjectLeaf =
  BudgetSig['outputs']['reportData']['sections'][number]['details'];

// --- unparseable signatures keep the permissive fallback -------------------
type FallbackSig = ParseSignature<'no arrow in sight'>;
type _fallback = Expect<Equal<FallbackSig['inputs'], Record<string, any>>>;

// --- negative control: a wrong expectation must fail to compile ------------
// (kept out of the witnesses tuple below — after the expected error the alias
// resolves to `false`)
// @ts-expect-error userAge must infer as optional number, not required string
type _negative = Expect<
  Equal<
    ObjectSig['outputs']['profileList'],
    { fullName: string; userAge: string }[]
  >
>;
type _negativeIsUsed = _negative | never;

describe('sigtypes extended grammar inference', () => {
  it('keeps runtime and type-level parsing in agreement', () => {
    const sig = s(
      'userAge:number(min 0, max 120) -> profileData:object{ fullName:string, nested:object{ deepValue:string } }'
    );
    const outputs = sig.getOutputFields();
    expect(outputs[0]?.type?.name).toBe('object');
    expect(outputs[0]?.type?.fields?.nested).toMatchObject({
      type: 'object',
      fields: { deepValue: { type: 'string' } },
    });
  });

  it('compiles the type-level assertions above', () => {
    const witnesses: [
      _bagInputs,
      _bagOutputs,
      _codeInputs,
      _codeOutputs,
      _objectOutput,
      _commaInput,
      _budgetLeaf,
      _fallback,
    ] = [true, true, true, true, true, true, true, true];
    expect(witnesses.every(Boolean)).toBe(true);
  });
});
