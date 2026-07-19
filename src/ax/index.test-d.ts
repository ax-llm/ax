// index.test-d.ts — compile-time tests for the public API surface, enforced by
// `npm run test:type-tests` (tsc -p tsconfig.typetests.json). Agent typing is
// covered separately in agent/agent.test-d.ts.

// === Typesafe Signature Tests ===
import { AxSignature } from './dsp/sig.js';
import type { AxExamples } from './dsp/types.js';
import {
  type AxAgentFunction,
  type AxAIService,
  type AxFunction,
  type AxFunctionHandler,
  type AxParetoResult,
  type AxProgrammable,
  ax,
  f,
  flow,
  fn,
  optimize,
} from './index.js';
import type { Equal, Expect, Flatten } from './util/typetest.js';

// Extract (and flatten) the inferred field objects from an AxSignature so they
// can be compared against plain object literals with Equal.
type SigIn<S> = S extends AxSignature<infer I, any> ? Flatten<I> : never;
type SigOut<S> = S extends AxSignature<any, infer O> ? Flatten<O> : never;

// Test basic signature type inference
const basicSig = AxSignature.create('question: string -> answer: string');
type _basicIn = Expect<Equal<SigIn<typeof basicSig>, { question: string }>>;
type _basicOut = Expect<Equal<SigOut<typeof basicSig>, { answer: string }>>;

// Test signature with optional fields and arrays
const complexSig = AxSignature.create(
  'userInput: string, context?: string[] -> responseText: string, citations: number[]'
);
type _complexIn = Expect<
  Equal<SigIn<typeof complexSig>, { userInput: string; context?: string[] }>
>;
type _complexOut = Expect<
  Equal<
    SigOut<typeof complexSig>,
    { responseText: string; citations: number[] }
  >
>;

// Test signature with multiple types
const multiTypeSig = AxSignature.create(
  'title: string, count: number, isActive: boolean -> analysisResult: string, score: number'
);
type _multiTypeIn = Expect<
  Equal<
    SigIn<typeof multiTypeSig>,
    { title: string; count: number; isActive: boolean }
  >
>;
type _multiTypeOut = Expect<
  Equal<SigOut<typeof multiTypeSig>, { analysisResult: string; score: number }>
>;

// Test signature with missing types (should default to string)
const missingTypesSig = AxSignature.create(
  'question, animalImage: image -> answer'
);
type _missingTypesIn = Expect<
  Equal<
    SigIn<typeof missingTypesSig>,
    { question: string; animalImage: { mimeType: string; data: string } }
  >
>;
type _missingTypesOut = Expect<
  Equal<SigOut<typeof missingTypesSig>, { answer: string }>
>;

// Signatures that fail to parse keep the permissive fallback shape at the
// type level (runtime create() still throws on them)
const invalidSig = AxSignature.create('invalid format without arrow');
type _invalidIn = Expect<Equal<SigIn<typeof invalidSig>, Record<string, any>>>;
type _invalidOut = Expect<
  Equal<SigOut<typeof invalidSig>, Record<string, any>>
>;
const emptySig = AxSignature.create('');
type _emptyIn = Expect<Equal<SigIn<typeof emptySig>, Record<string, any>>>;

// Test type-safe field addition methods
const testSig = AxSignature.create('userInput: string -> responseText: string');

// Test appendInputField type inference. Field-addition methods add the value
// type but do not thread `isOptional` through to the type level — the added
// field stays required in the inferred inputs (the runtime field is optional).
const withAppendedInput = testSig.appendInputField('contextInfo', {
  type: 'string',
  description: 'Context',
  isOptional: true,
});
type _appendedInputIn = Expect<
  Equal<
    SigIn<typeof withAppendedInput>,
    { userInput: string; contextInfo: string }
  >
>;
type _appendedInputOut = Expect<
  Equal<SigOut<typeof withAppendedInput>, { responseText: string }>
>;

// Test prependInputField type inference
const withPrependedInput = testSig.prependInputField(
  'sessionId',
  f.string('Session ID')
);
type _prependedInputIn = Expect<
  Equal<
    SigIn<typeof withPrependedInput>,
    { sessionId: string; userInput: string }
  >
>;

// Test appendOutputField type inference
const withAppendedOutput = testSig.appendOutputField(
  'confidence',
  f.number('Confidence score')
);
type _appendedOutputOut = Expect<
  Equal<
    SigOut<typeof withAppendedOutput>,
    { responseText: string; confidence: number }
  >
>;

// Test prependOutputField type inference. Class options do not survive the
// field-addition methods at the type level — the field is typed string (the
// fluent f() builder path below does preserve the literal union).
const withPrependedOutput = testSig.prependOutputField(
  'category',
  f.class(['urgent', 'normal', 'low'], 'Priority')
);
type _prependedOutputOut = Expect<
  Equal<
    SigOut<typeof withPrependedOutput>,
    { category: string; responseText: string }
  >
>;

// Test chaining type inference
const chainedSig = testSig
  .appendInputField('metadata', {
    type: 'json',
    description: 'Metadata',
    isOptional: true,
  })
  .prependOutputField('status', f.class(['success', 'error'], 'Status'))
  .appendOutputField('timestamp', f.datetime('Timestamp'));

type _chainedIn = Expect<
  Equal<SigIn<typeof chainedSig>, { userInput: string; metadata: any }>
>;
type _chainedOut = Expect<
  Equal<
    SigOut<typeof chainedSig>,
    { status: string; responseText: string; timestamp: Date }
  >
>;

// Test array type inference
const arraySig = testSig
  .appendInputField('tags', {
    type: 'string',
    description: 'Tag names',
    isArray: true,
  })
  .appendOutputField('suggestions', {
    type: 'string',
    description: 'Suggestions',
    isArray: true,
  });

type _arrayIn = Expect<
  Equal<SigIn<typeof arraySig>, { userInput: string; tags: string[] }>
>;
type _arrayOut = Expect<
  Equal<
    SigOut<typeof arraySig>,
    { responseText: string; suggestions: string[] }
  >
>;

// === Fluent API Builder Type Tests ===
// Fields built via f() are readonly in the inferred signature types.
const fluentSig = f()
  .input('query', f.string('Query to the vector database'))
  .output('context', f.string('Context retrieved from the vector database'))
  .build();

type _fluentIn = Expect<
  Equal<SigIn<typeof fluentSig>, { readonly query: string }>
>;
type _fluentOut = Expect<
  Equal<SigOut<typeof fluentSig>, { readonly context: string }>
>;

// Test fluent API with complex types
const complexFluentSig = f()
  .input('userInput', f.string('User input'))
  .input('metadata', f.json('Optional metadata').optional())
  .input('tags', f.string('Tag list').array())
  .output('responseText', f.string('Response text'))
  .output('confidence', f.number('Confidence score'))
  .output('categories', f.string('Categories').array())
  .build();

type _complexFluentIn = Expect<
  Equal<
    SigIn<typeof complexFluentSig>,
    {
      readonly userInput: string;
      readonly metadata?: any;
      readonly tags: string[];
    }
  >
>;
type _complexFluentOut = Expect<
  Equal<
    SigOut<typeof complexFluentSig>,
    {
      readonly responseText: string;
      readonly confidence: number;
      readonly categories: string[];
    }
  >
>;

// Test fluent API with chained modifiers and internal exclusion
const fluentChained = f()
  .input('optionalList', f.string('Optional list').optional().array())
  .input('requiredList', f.string('Required list').array())
  .output('publicValue', f.number('Public value'))
  .output('internalValue', f.string('Internal value').internal())
  .build();

type _fluentChainedIn = Expect<
  Equal<
    SigIn<typeof fluentChained>,
    { readonly optionalList?: string[]; readonly requiredList: string[] }
  >
>;
type _fluentChainedOut = Expect<
  Equal<SigOut<typeof fluentChained>, { readonly publicValue: number }>
>;

// Test fluent API boolean/number inference
const fluentPrimitives = f()
  .input('boolFlag', f.boolean('Flag'))
  .input('threshold', f.number('Threshold'))
  .output('ok', f.boolean('OK'))
  .output('count', f.number('Count'))
  .build();

type _fluentPrimitivesIn = Expect<
  Equal<
    SigIn<typeof fluentPrimitives>,
    { readonly boolFlag: boolean; readonly threshold: number }
  >
>;
type _fluentPrimitivesOut = Expect<
  Equal<
    SigOut<typeof fluentPrimitives>,
    { readonly ok: boolean; readonly count: number }
  >
>;

// === AxGen (ax) Type Tests ===
// ax() creates generators whose forward() returns the typed outputs
const basicGenerator = ax('userInput:string -> responseText:string');
{
  type Result = Awaited<ReturnType<typeof basicGenerator.forward>>;
  const _ok: Result = { responseText: 'hi' };
  const _withThought: Result = { responseText: 'hi', thought: 'because' };
  void [_ok, _withThought];
}

// Multiline string signatures parse at the type level too. The splitter
// accepts any whitespace around `->` (lockstep with the runtime grammar), so
// the arrow may end a line — as here — or start the next one.
const complexGenerator = ax(`
  userQuery:string "User question",
  contextData:json "Background info" ->
  responseText:string "AI response",
  confidence:number "Confidence 0-1",
  categories:string[] "Response categories"
`);
{
  type Result = Awaited<ReturnType<typeof complexGenerator.forward>>;
  const _ok: Result = {
    responseText: 'r',
    confidence: 0.9,
    categories: ['a'],
  };
  // @ts-expect-error missing required output fields
  const _bad: Result = { responseText: 'r' };
  void [_ok, _bad];
}

// Optional inputs and class outputs infer union types
const optionalGenerator = ax(`
  userInput:string,
  metadata?:json
  -> responseText:string,
  sentiment:class "positive, negative, neutral"
`);
{
  type Result = Awaited<ReturnType<typeof optionalGenerator.forward>>;
  const _ok: Result = { responseText: 'r', sentiment: 'positive' };
  // @ts-expect-error sentiment must be one of the class options
  const _bad: Result = { responseText: 'r', sentiment: 'angry' };
  void [_ok, _bad];
}

// === fn() Function Builder Type Tests ===
const calculatedTool = fn('calculate')
  .description('Evaluate a math expression')
  .arg('expression', f.string('Math expression'))
  .arg('precision', f.number('Optional precision').optional())
  .returns(f.number('Calculated result'))
  .handler(({ expression, precision }, extra) => {
    type _expression = Expect<Equal<typeof expression, string>>;
    type _precision = Expect<Equal<typeof precision, number | undefined>>;
    type _extra = Expect<
      Equal<typeof extra, Parameters<AxFunctionHandler>[1] | undefined>
    >;
    void extra;
    return Number(expression) + (precision ?? 0);
  })
  .build();

const _calculatedTool: AxFunction = calculatedTool;
const calculatedResult = calculatedTool.func({ expression: '2', precision: 3 });
type _calculatedResult = Expect<
  Equal<typeof calculatedResult, number | Promise<number>>
>;

const searchTool = fn('search')
  .description('Search the product catalog')
  .namespace('db')
  .arg('query', f.string('Search query'))
  .returnsField('results', f.string('Result item').array())
  .returnsField('count', f.number('Result count').optional())
  .handler(({ query }) => ({
    results: [query],
    count: 1,
  }))
  .build();

const _searchTool: AxFunction = searchTool;
const _searchResult:
  | { readonly results: string[]; readonly count?: number }
  | Promise<{ readonly results: string[]; readonly count?: number }> =
  searchTool.func({ query: 'ax' });

const agentTool = fn('lookupSchedule')
  .description('Lookup schedule data')
  .namespace('kb')
  .arg('topic', f.string('Topic'))
  .returns(f.string('Lookup result'))
  .example({
    title: 'Simple lookup',
    code: 'await kb.lookupSchedule({ topic: "alex" });',
  })
  .handler(({ topic }) => topic)
  .build();

const _agentTool: AxAgentFunction = agentTool;

// === String signature type inference parity with fluent API ===
// Internal outputs are excluded; optional and arrays respected
const parsedInternalSig = AxSignature.create(
  'userText:string -> publicOut:string, hiddenOut!:number, optionalHidden?!:string, optionalList?:string[]'
);
type _parsedInternalIn = Expect<
  Equal<SigIn<typeof parsedInternalSig>, { userText: string }>
>;
type _parsedInternalOut = Expect<
  Equal<
    SigOut<typeof parsedInternalSig>,
    { publicOut: string; optionalList?: string[] }
  >
>;

// === AxExamples utility tests ===
// AxExamples is an array of example items (outputs plus optional inputs)
type ExamplesFromString =
  AxExamples<'userInput:string -> responseText:string, score:number'>;
const _examplesFromString: ExamplesFromString = [
  { responseText: 'ok', score: 1 },
  { responseText: 'ok', score: 1, userInput: 'x' },
];
// @ts-expect-error required output fields must be present in every example
const _examplesMissingOutput: ExamplesFromString = [{ score: 1 }];
void [_examplesFromString, _examplesMissingOutput];

const sigFromBuilder = f()
  .input('ctx', f.string('Context').optional())
  .input('flag', f.boolean('Flag'))
  .output('out', f.string('Out'))
  .build();
type ExamplesFromBuilder = AxExamples<typeof sigFromBuilder>;
const _examplesFromBuilder: ExamplesFromBuilder = [
  { out: 'v', flag: true },
  { out: 'v', flag: true, ctx: 'c' },
];
void _examplesFromBuilder;

const gen = ax('userInput:string -> responseText:string, count:number');
type ExamplesFromGen = AxExamples<typeof gen>;
const _examplesFromGen: ExamplesFromGen = [
  { responseText: 'a', count: 1, userInput: 'x' },
  { responseText: 'b', count: 2 },
];
void _examplesFromGen;

// === AxFlow (flow) Type Tests ===
// The state lambdas below are the compile-time assertions: they fail when the
// evolving state type stops carrying the declared fields. Result typing of
// returns() is covered in flow/flow.test-d.ts.
const basicFlow = flow<{ userInput: string }>().map((state) => ({
  processedInput: state.userInput.toUpperCase(),
  inputLength: state.userInput.length,
}));
void basicFlow.forward;

// Test flow() with node execution creates working workflow
const nodeFlow = flow<{ documentText: string }>()
  .node('summarizer', 'content:string -> summary:string, wordCount:number')
  .execute('summarizer', (state) => ({ content: state.documentText }))
  .map((state) => ({
    originalText: state.documentText,
    summaryResult: (state.summarizerResult?.summary as string) || '',
    wordCount: (state.summarizerResult?.wordCount as number) || 0,
  }));
void nodeFlow.forward;

// Test flow() with complex multi-node workflow
const complexFlow = flow<{ userQuery: string }>()
  .node('searcher', 'query:string -> results:string[], count:number')
  .node('analyzer', 'data:string[] -> hasResults:boolean')
  .execute('searcher', (state) => ({ query: state.userQuery }))
  .execute('analyzer', (state) => ({
    data: (state.searcherResult?.results as string[]) || [],
  }))
  .map((state) => ({
    originalQuery: state.userQuery,
    searchResults: (state.searcherResult?.results as string[]) || [],
    totalResults: (state.searcherResult?.count as number) || 0,
    hasResults: (state.analyzerResult?.hasResults as boolean) || false,
  }));
void complexFlow.forward;

// === optimize() Type Tests ===
const optimizeAI = {} as AxAIService;
const _optimizedGen: Promise<AxParetoResult<any>> = optimize(
  basicGenerator,
  [{ userInput: 'hello' }],
  ({ prediction }) => ((prediction as any).responseText ? 1 : 0),
  {
    studentAI: optimizeAI,
    maxMetricCalls: 2,
  }
);
const _optimizedFlow: Promise<AxParetoResult<any>> = optimize(
  nodeFlow,
  [{ documentText: 'hello' }],
  ({ prediction }) => ((prediction as any).summaryResult ? 1 : 0),
  {
    studentAI: optimizeAI,
    maxMetricCalls: 2,
    bootstrap: false,
  }
);
const programmable = basicGenerator as AxProgrammable<
  { userInput: string },
  { responseText: string }
>;
const _optimizedProgrammable: Promise<
  AxParetoResult<{ responseText: string }>
> = optimize(programmable, [{ userInput: 'hello' }], () => 1, {
  studentAI: optimizeAI,
  maxMetricCalls: 2,
  bootstrap: { maxDemos: 1, qualityThreshold: 0.5 },
});

// Test flow() with optional fields
const optionalFlow = flow<{
  requiredField: string;
  optionalField?: string;
}>().map((state) => ({
  processedRequired: state.requiredField.trim(),
  processedOptional: state.optionalField?.trim(),
  hasOptional: !!state.optionalField,
}));
void optionalFlow.forward;

// Test flow() with array handling
const arrayFlow = flow<{ items: string[] }>().map((state) => ({
  originalItems: state.items,
  itemCount: state.items.length,
  firstItem: state.items[0] || '',
  uppercaseItems: state.items.map((item) => item.toUpperCase()),
}));
void arrayFlow.forward;
