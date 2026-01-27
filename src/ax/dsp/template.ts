import { AxGen } from './generate.js';
import { AxSignature } from './sig.js';
import type { ParseSignature } from './sigtypes.js';
import type { AxProgramForwardOptions } from './types.js';

/**
 * Creates a type-safe signature from a string template.
 *
 * @param signature - The signature string in the format `"inputFields -> outputFields"`
 * @returns A typed AxSignature instance
 *
 * @example
 * ```typescript
 * const sig = s('question: string -> answer: string');
 * ```
 */
export function s<const T extends string>(
  signature: T
): AxSignature<ParseSignature<T>['inputs'], ParseSignature<T>['outputs']> {
  return AxSignature.create(signature);
}

/**
 * Creates a type-safe AI generator from a signature string or AxSignature object.
 *
 * This is the primary way to define AI-powered functions in Ax. The signature string
 * declares input and output fields with their types, which are then used to generate
 * prompts and parse responses.
 *
 * **Signature String Format:**
 * ```
 * "inputField1: type, inputField2: type -> outputField1: type, outputField2: type"
 * ```
 *
 * **Supported Field Types:**
 * - `string` - Text content (default if no type specified)
 * - `number` - Numeric values (integers or floats)
 * - `boolean` - True/false values
 * - `json` - Arbitrary JSON objects
 * - `date` - Date in YYYY-MM-DD format
 * - `datetime` - ISO 8601 datetime
 * - `code` - Code blocks (preserves formatting)
 * - `image` - Image input (for multimodal models)
 * - `audio` - Audio input
 * - `class` - Classification with predefined options: `class(option1, option2, option3)`
 *
 * **Type Modifiers:**
 * - `[]` suffix - Array of values: `tags: string[]`
 * - `?` suffix - Optional field: `context?: string`
 * - `!` prefix - Internal field (hidden from output): `!reasoning: string`
 *
 * **Field Descriptions:**
 * Add descriptions after the type using a string literal:
 * ```
 * "question: string 'The user question' -> answer: string 'A helpful response'"
 * ```
 *
 * @param signature - Either a signature string or a pre-built AxSignature object
 * @param options - Optional configuration for the generator
 * @param options.thoughtFieldName - Custom name for chain-of-thought field (default: 'thought')
 *
 * @returns An AxGen instance that can be executed with `.forward(ai, inputs)`
 *
 * @example Simple question-answering
 * ```typescript
 * const qa = ax('question: string -> answer: string');
 * const result = await qa.forward(ai, { question: 'What is TypeScript?' });
 * console.log(result.answer);
 * ```
 *
 * @example Classification with predefined options
 * ```typescript
 * const classifier = ax('text: string -> sentiment: class(positive, negative, neutral)');
 * const result = await classifier.forward(ai, { text: 'I love this!' });
 * console.log(result.sentiment); // 'positive'
 * ```
 *
 * @example Multiple outputs with arrays
 * ```typescript
 * const extractor = ax(`
 *   document: string ->
 *   summary: string,
 *   keywords: string[],
 *   wordCount: number
 * `);
 * const result = await extractor.forward(ai, { document: longText });
 * ```
 *
 * @example With chain-of-thought reasoning
 * ```typescript
 * const solver = ax('problem: string -> solution: string', {
 *   thoughtFieldName: 'reasoning'
 * });
 * // Enable thinking in forward options to get step-by-step reasoning
 * ```
 *
 * @example Using function tools
 * ```typescript
 * const agent = ax('query: string -> response: string');
 * const result = await agent.forward(ai, { query: 'What is 25 * 4?' }, {
 *   functions: [{
 *     name: 'calculate',
 *     description: 'Perform math calculations',
 *     parameters: { type: 'object', properties: { expression: { type: 'string' } } },
 *     func: ({ expression }) => eval(expression)
 *   }]
 * });
 * ```
 */
export function ax<
  const T extends string,
  ThoughtKey extends string = 'thought',
>(
  signature: T,
  options?: Readonly<
    AxProgramForwardOptions<any> & { thoughtFieldName?: ThoughtKey }
  >
): AxGen<
  ParseSignature<T>['inputs'],
  ParseSignature<T>['outputs'] &
    (string extends ThoughtKey
      ? { thought?: string }
      : { [P in ThoughtKey]?: string })
>;
export function ax<
  TInput extends Record<string, any>,
  TOutput extends Record<string, any>,
  ThoughtKey extends string = 'thought',
>(
  signature: AxSignature<TInput, TOutput>,
  options?: Readonly<
    AxProgramForwardOptions<any> & { thoughtFieldName?: ThoughtKey }
  >
): AxGen<
  TInput,
  TOutput &
    (string extends ThoughtKey
      ? { thought?: string }
      : { [P in ThoughtKey]?: string })
>;
export function ax<
  T extends string | AxSignature<any, any>,
  ThoughtKey extends string = 'thought',
  TInput extends Record<string, any> = T extends string
    ? ParseSignature<T>['inputs']
    : T extends AxSignature<infer I, any>
      ? I
      : never,
  TOutput extends Record<string, any> = T extends string
    ? ParseSignature<T>['outputs']
    : T extends AxSignature<any, infer O>
      ? O
      : never,
>(
  signature: T,
  options?: Readonly<
    AxProgramForwardOptions<any> & { thoughtFieldName?: ThoughtKey }
  >
): AxGen<
  TInput,
  TOutput &
    (string extends ThoughtKey
      ? { thought?: string }
      : { [P in ThoughtKey]?: string })
> {
  const typedSignature =
    typeof signature === 'string'
      ? AxSignature.create(signature)
      : (signature as AxSignature<TInput, TOutput>);
  return new AxGen<
    TInput,
    TOutput &
      (string extends ThoughtKey
        ? { thought?: string }
        : { [P in ThoughtKey]?: string })
  >(typedSignature, options as any);
}
