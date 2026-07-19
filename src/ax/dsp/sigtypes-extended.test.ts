import { describe, expect, it } from 'vitest';
import type { Equal, Expect, Flatten } from '../util/typetest.js';
import type { ParseSignature } from './sigtypes.js';
import { s } from './template.js';

// Compile-time assertions for the extended signature grammar. The type-level
// witnesses are enforced by `npm run test:type-tests` (tsc -p
// tsconfig.typetests.json, part of `npm test`), which also covers the
// *.test-d.ts files; the runtime parity check below runs under vitest.

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

// --- signatures that fail to parse keep the permissive fallback ------------
type FallbackSig = ParseSignature<'no arrow in sight'>;
type _fallback = Expect<Equal<FallbackSig['inputs'], Record<string, any>>>;

// --- any whitespace around the arrow separates inputs from outputs ---------
// Lockstep with the runtime parser, which skips whitespace on both sides of
// `->`: in a multiline template literal the arrow may end a line, sit alone
// on one, or be surrounded by tabs.
type TrailingArrowSig = ParseSignature<`
  userQuery:string "User question",
  topicTags:string[] ->
  responseText:string "AI response",
  confidence:number
`>;
type _trailingArrowInputs = Expect<
  Equal<
    Flatten<TrailingArrowSig['inputs']>,
    { userQuery: string; topicTags: string[] }
  >
>;
type _trailingArrowOutputs = Expect<
  Equal<
    Flatten<TrailingArrowSig['outputs']>,
    { responseText: string; confidence: number }
  >
>;

type ArrowOnOwnLineSig = ParseSignature<`
  userQuery:string
  ->
  responseText:string
`>;
type _arrowOnOwnLine = Expect<
  Equal<Flatten<ArrowOnOwnLineSig['outputs']>, { responseText: string }>
>;

type LeadingArrowSig = ParseSignature<`
  userQuery:string
  -> responseText:string
`>;
type _leadingArrow = Expect<
  Equal<Flatten<LeadingArrowSig['inputs']>, { userQuery: string }>
>;

type TabArrowSig = ParseSignature<'userQuery:string\t->\tresponseText:string'>;
type _tabArrow = Expect<
  Equal<Flatten<TabArrowSig['outputs']>, { responseText: string }>
>;

// A `->` without surrounding whitespace (here inside a quoted description) is
// not a separator; the scan resumes and splits at the real arrow after it.
type QuotedArrowSig =
  ParseSignature<'sourceText:string "maps a->b" -> replyText:string'>;
type _quotedArrowInputs = Expect<
  Equal<Flatten<QuotedArrowSig['inputs']>, { sourceText: string }>
>;

// The runtime also accepts an arrow with no whitespace at all; the type level
// deliberately keeps the whitespace requirement (dropping it would split
// quoted arrows like the one above), so that spelling keeps the fallback.
type BareArrowSig = ParseSignature<'userQuery:string->responseText:string'>;
type _bareArrowFallback = Expect<
  Equal<BareArrowSig['inputs'], Record<string, any>>
>;

// --- a leading description may end its line in a multiline signature -------
// Lockstep with the runtime parser, which skips any whitespace between the
// closing quote and the first field; a literal-space-only match would leak
// the quoted text into the first input field's inferred key.
type DescriptionOnOwnLineSig = ParseSignature<`
  "Analyze the text"
  sourceText:string ->
  replyText:string
`>;
type _descriptionOwnLineInputs = Expect<
  Equal<Flatten<DescriptionOnOwnLineSig['inputs']>, { sourceText: string }>
>;
type _descriptionOwnLineOutputs = Expect<
  Equal<Flatten<DescriptionOnOwnLineSig['outputs']>, { replyText: string }>
>;

// The single-line spelling with a plain space after the quote keeps working.
type DescriptionSameLineSig =
  ParseSignature<'"Analyze the text" sourceText:string -> replyText:string'>;
type _descriptionSameLineInputs = Expect<
  Equal<Flatten<DescriptionSameLineSig['inputs']>, { sourceText: string }>
>;

// --- negative control: a wrong expectation must fail to compile ------------
// (kept out of the witnesses tuple below — after the expected error the alias
// resolves to `false`. The Equal is computed on its own line so the Expect
// witness stays single-line and the suppressed error lands directly under the
// directive.)
type _negativeCheck = Equal<
  ObjectSig['outputs']['profileList'],
  { fullName: string; userAge: string }[]
>;
// @ts-expect-error userAge must infer as optional number, not required string
type _negative = Expect<_negativeCheck>;
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

  it('accepts a multiline signature with the arrow at end of line at runtime', () => {
    const sig = s(`
      userQuery:string "User question",
      topicTags:string[] ->
      responseText:string "AI response",
      confidence:number
    `);
    expect(sig.getInputFields().map((f) => f.name)).toEqual([
      'userQuery',
      'topicTags',
    ]);
    expect(sig.getOutputFields().map((f) => f.name)).toEqual([
      'responseText',
      'confidence',
    ]);
  });

  it('accepts a description on its own line at runtime', () => {
    const sig = s(`
      "Analyze the text"
      sourceText:string ->
      replyText:string
    `);
    expect(sig.getDescription()).toBe('Analyze the text');
    expect(sig.getInputFields().map((f) => f.name)).toEqual(['sourceText']);
    expect(sig.getOutputFields().map((f) => f.name)).toEqual(['replyText']);
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
      _trailingArrowInputs,
      _trailingArrowOutputs,
      _arrowOnOwnLine,
      _leadingArrow,
      _tabArrow,
      _quotedArrowInputs,
      _bareArrowFallback,
      _descriptionOwnLineInputs,
      _descriptionOwnLineOutputs,
      _descriptionSameLineInputs,
    ] = [
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ];
    expect(witnesses.every(Boolean)).toBe(true);
  });
});
