// === Typesafe Signature Parsing Types ===
//
// This module provides TypeScript type-level parsing of signature strings to enable
// compile-time type inference for input and output types. It works alongside the
// runtime parser in parser.ts to provide both runtime validation and static typing.
//
// CORE INNOVATION: QUOTE-AWARE COMMA PARSING
// ==========================================
// The main challenge solved here is parsing comma-separated fields when commas can appear
// both as field separators AND inside quoted strings (like class definitions).
//
// PROBLEM: 'sourceType:class "class1, class2, class3", relevantContext:string, sources:string'
// ├─ Simple split on commas would break the quoted class definition
// ├─ Need to distinguish between separator commas and literal commas
// └─ Solution: Character-by-character state machine that tracks quote state
//
// PARSING PIPELINE:
// =================
// 1. ParseSignature: Main entry point, splits "inputs -> outputs"
// 2. ParseFields: Uses quote-aware parsing to split field lists correctly
// 3. SplitFieldsRespectingQuotes: Core algorithm - state machine for comma parsing
// 4. StringArrayToFields: Converts field strings to structured objects
// 5. ParseNameAndType: Parses individual field syntax (name:type, optional?, descriptions)
// 6. BuildObject: Converts field tuples to final TypeScript object types
//
// CAPABILITIES:
// - Basic types: string, number, boolean, json, date, dateRange, datetime, datetimeRange, image, audio, file, url, code
// - Array types: string[], number[], boolean[], etc.
// - Class types with comma-separated options: class "option1, option2, option3"
// - Optional fields: fieldName?:type
// - Field descriptions: fieldName:type "description"
// - Signature descriptions: "description" inputs -> outputs
// - Multi-field input/output signatures
// - Complex nested comma handling in quoted strings
// - Modifier bags are skipped for inference: number(min 0, max 10) infers as
//   number, code(python) as string — constraints never change the TS type
// - Nested objects infer structurally: object{ name:string, age?:number }[]
//   infers as { name: string; age?: number }[], recursively
//
// LIMITATIONS:
// - TypeScript's template literal type system has recursion and complexity limits
// - Very long signatures (>50 fields) may hit TypeScript compiler limits;
//   practical envelope for nested objects is ~4 nesting levels / ~2k chars
// - Internal markers (!) are supported in type inference for output fields and are excluded from output types
// - Deeply nested quote escaping is not supported
// - Unknown or malformed constructs degrade to `any` (or the
//   Record<string, any> fallback) — the runtime parser in parser.ts is the
//   strict layer that reports real errors. A regex pattern containing an
//   unbalanced ")" inside its quotes may degrade that one field to `any`.
//
// PERFORMANCE:
// - Optimized for common cases (1-10 fields per signature)
// - State machine approach is efficient for TypeScript's type checker
// - Falls back gracefully for edge cases that exceed compiler limits
//
// For full feature support and complex signatures, the runtime parser in parser.ts
// provides complete functionality. This type system provides compile-time inference
// for the vast majority of real-world use cases.

import type { AxAudioInput, AxChatAudioOutput } from '../ai/types.js';

/**
 * A map of string type names to their corresponding TypeScript types.
 * Maps signature type strings to actual TypeScript types for type inference.
 *
 * IMPORTANT: The 'object' type is NOT included in this map. A bare `object`
 * (no braces) is treated the same as 'json' and inferred as 'any', while
 * `object{ ... }` bodies are inferred structurally via ParseObjectBody —
 * they never reach this map.
 *
 * The fluent API expresses the same structured objects programmatically:
 * f().output('user', f.object({ name: f.string(), age: f.number() }))
 */
export interface InputTypeMap {
  string: string;
  number: number;
  boolean: boolean;
  json: any; // Flexible type - accepts any JSON value
  date: Date;
  dateRange: { start: Date; end: Date };
  datetime: Date;
  datetimeRange: { start: Date; end: Date };
  image: { mimeType: string; data: string };
  audio: AxAudioInput;
  file:
    | { mimeType: string; data: string }
    | { mimeType: string; fileUri: string };
  url: string;
  code: string;
  // Note: 'object' is intentionally NOT here - it maps to 'any' like 'json'
}

export interface OutputTypeMap extends Omit<InputTypeMap, 'audio'> {
  audio: AxChatAudioOutput;
}

type TypeMapForMode<TMode extends 'input' | 'output'> = TMode extends 'output'
  ? OutputTypeMap
  : InputTypeMap;

// Helper type to parse class options from a string like "option1, option2, option3" or "option1 | option2 | option3"
type ParseClassOptions<S extends string> =
  S extends `${infer First},${infer Rest}`
    ? Trim<First> | ParseClassOptions<Trim<Rest>>
    : S extends `${infer First}|${infer Rest}`
      ? Trim<First> | ParseClassOptions<Trim<Rest>>
      : S extends `${infer First} | ${infer Rest}`
        ? Trim<First> | ParseClassOptions<Trim<Rest>>
        : S extends `${infer First}, ${infer Rest}`
          ? Trim<First> | ParseClassOptions<Trim<Rest>>
          : Trim<S>;

// Helper type to resolve the actual TypeScript type from a parsed type string
type ResolveType<
  T extends string,
  TMode extends 'input' | 'output',
> = T extends keyof TypeMapForMode<TMode>
  ? TypeMapForMode<TMode>[T]
  : // Object tags must be checked before the array branch: an object body can
    // itself end in "[]" and would otherwise be misread as an array type.
    T extends `obj[]|${infer Body}`
    ? ParseObjectBody<Body, TMode>[]
    : T extends `obj|${infer Body}`
      ? ParseObjectBody<Body, TMode>
      : T extends `${infer BaseType}[]`
        ? BaseType extends keyof TypeMapForMode<TMode>
          ? TypeMapForMode<TMode>[BaseType][]
          : any[]
        : T extends `class[]|${infer Options}`
          ? ParseClassOptions<Options>[]
          : T extends `class|${infer Options}`
            ? ParseClassOptions<Options>
            : T extends 'class'
              ? string // fallback for class without options
              : any; // fallback for unknown types

// Recursively parses the body of an `object{ ... }` type into a structural
// object type, reusing the full field pipeline. The mapped-type wrap flattens
// BuildObject's required & optional intersection into a single object type.
type ParseObjectBody<
  Body extends string,
  TMode extends 'input' | 'output',
> = BuildObject<ParseFields<Trim<Body>>, TMode> extends infer O
  ? { [K in keyof O]: O[K] }
  : never;

// Helper to trim whitespace from a type string
type Trim<S extends string> = S extends ` ${infer T}`
  ? Trim<T>
  : S extends `\n${infer T}`
    ? Trim<T>
    : S extends `\t${infer T}`
      ? Trim<T>
      : S extends `\r${infer T}`
        ? Trim<T>
        : S extends `${infer U} `
          ? Trim<U>
          : S extends `${infer U}\n`
            ? Trim<U>
            : S extends `${infer U}\t`
              ? Trim<U>
              : S extends `${infer U}\r`
                ? Trim<U>
                : S;

// Parses a single field, checking for optional (?) and internal (!) markers in any order at the end of the name
type ParseField<S extends string> = S extends `${infer Name}?!`
  ? { name: Trim<Name>; optional: true; internal: true }
  : S extends `${infer Name}!?`
    ? { name: Trim<Name>; optional: true; internal: true }
    : S extends `${infer Name}?`
      ? { name: Trim<Name>; optional: true; internal: false }
      : S extends `${infer Name}!`
        ? { name: Trim<Name>; optional: false; internal: true }
        : { name: Trim<S>; optional: false; internal: false };

// Extracts the body of a balanced `{ ... }` block. S starts AFTER the opening
// brace; returns [body, restAfterClosingBrace]. Quote-aware so descriptions
// containing braces don't unbalance the scan. Tail-recursive.
type TakeBraced<
  S extends string,
  Depth extends 0[] = [],
  Body extends string = '',
  InQuote extends boolean = false,
> = S extends `${infer Char}${infer Rest}`
  ? Char extends '"'
    ? TakeBraced<
        Rest,
        Depth,
        `${Body}${Char}`,
        InQuote extends true ? false : true
      >
    : InQuote extends true
      ? TakeBraced<Rest, Depth, `${Body}${Char}`, true>
      : Char extends '{'
        ? TakeBraced<Rest, [...Depth, 0], `${Body}${Char}`, false>
        : Char extends '}'
          ? Depth['length'] extends 0
            ? [Body, Rest]
            : TakeBraced<
                Rest,
                Depth extends [...infer D extends 0[], 0] ? D : [],
                `${Body}${Char}`,
                false
              >
          : TakeBraced<Rest, Depth, `${Body}${Char}`, false>
  : [Body, ''];

// Tags an object type expression as `obj|body` or `obj[]|body` so ResolveType
// can recurse into the body later.
type ExtractObjectTag<Rest extends string> = TakeBraced<Rest> extends [
  infer Body extends string,
  infer After extends string,
]
  ? Trim<After> extends `[]${string}`
    ? `obj[]|${Body}`
    : `obj|${Body}`
  : never;

// Helper to extract type from a string, handling class with descriptions,
// object bodies, and modifier bags. Order matters: class first (its quoted
// options may contain anything), then object bodies, then bag stripping,
// then arrays/descriptions.
type ExtractType<S extends string> =
  S extends `class[] "${infer Options}" "${infer _Desc}"`
    ? `class[]|${Options}`
    : S extends `class[] "${infer Options}"`
      ? `class[]|${Options}`
      : S extends `class "${infer Options}" "${infer _Desc}"`
        ? `class|${Options}`
        : S extends `class "${infer Options}"`
          ? `class|${Options}`
          : S extends `object{${infer Rest}`
            ? ExtractObjectTag<Rest>
            : S extends `${infer Base}(${infer _Bag})${infer Suffix}`
              ? ExtractType<`${Base}${Suffix}`>
              : S extends `${infer Type}[] "${infer _Desc}"`
                ? `${Type}[]`
                : S extends `${infer Type}[]`
                  ? `${Type}[]`
                  : S extends `${infer Type} "${infer _Desc}"`
                    ? Type
                    : S;

// Parses a "name: type" or "name?: type" part, now handling arrays, class types, and descriptions
// If no type is specified, defaults to 'string'
type ParseNameAndType<S extends string> =
  S extends `${infer Name}:${infer TypePart}`
    ? ParseField<Name> & { type: Trim<ExtractType<Trim<TypePart>>> }
    : S extends `${infer Name} "${infer _Description}"`
      ? ParseField<Name> & { type: 'string' }
      : ParseField<S> & { type: 'string' };

/**
 * Advanced field splitting that respects quotes using a state machine approach.
 *
 * This type-level parser solves the core problem of parsing comma-separated fields
 * when commas can appear both as field separators AND inside quoted strings.
 *
 * PROBLEM EXAMPLE:
 * Input: 'sourceType:class "class1, class2, class3", relevantContext:string, sources:string'
 *
 * Simple comma splitting would incorrectly produce:
 * ['sourceType:class "class1', ' class2', ' class3"', ' relevantContext:string', ' sources:string']
 *
 * This parser correctly produces:
 * ['sourceType:class "class1, class2, class3"', 'relevantContext:string', 'sources:string']
 *
 * ALGORITHM:
 * 1. Process each character in the input string one by one
 * 2. Track whether we're currently inside or outside quotes
 * 3. When encountering a quote ("), toggle the quote state
 * 4. When encountering a comma (,):
 *    - If inside quotes: treat as literal character, add to current field
 *    - If outside quotes: treat as field separator, complete current field and start new one
 * 5. For all other characters: add to current field being built
 *
 * STATE PARAMETERS:
 * @param S - The remaining string to process
 * @param Current - The current field being built character by character
 * @param InQuote - Boolean state tracking if we're inside quotes
 * @param Result - Accumulator array of completed fields
 */
type SplitFieldsRespectingQuotes<
  S extends string,
  Current extends string = '',
  InQuote extends boolean = false,
  Result extends string[] = [],
  Depth extends 0[] = [],
> = S extends `${infer Char}${infer Rest}`
  ? Char extends '"'
    ? // Found a quote character - toggle the quote state
      // Add the quote to current field and flip InQuote boolean
      SplitFieldsRespectingQuotes<
        Rest,
        `${Current}${Char}`,
        InQuote extends true ? false : true,
        Result,
        Depth
      >
    : InQuote extends true
      ? // Inside quotes every character (commas, parens, braces) is literal
        SplitFieldsRespectingQuotes<
          Rest,
          `${Current}${Char}`,
          true,
          Result,
          Depth
        >
      : Char extends '(' | '{'
        ? // Entering a modifier bag or object body - commas inside don't split
          SplitFieldsRespectingQuotes<
            Rest,
            `${Current}${Char}`,
            false,
            Result,
            [...Depth, 0]
          >
        : Char extends ')' | '}'
          ? SplitFieldsRespectingQuotes<
              Rest,
              `${Current}${Char}`,
              false,
              Result,
              Depth extends [...infer D extends 0[], 0] ? D : []
            >
          : Char extends ','
            ? Depth['length'] extends 0
              ? // Top-level comma - this is a field separator
                Rest extends ` ${infer RestTrimmed}`
                ? // Handle ", " (comma + space) separator - skip the space
                  SplitFieldsRespectingQuotes<
                    RestTrimmed,
                    '',
                    false,
                    [...Result, Current],
                    Depth
                  >
                : // Handle "," (comma only) separator
                  SplitFieldsRespectingQuotes<
                    Rest,
                    '',
                    false,
                    [...Result, Current],
                    Depth
                  >
              : // Comma nested inside (...) or {...} - literal character
                SplitFieldsRespectingQuotes<
                  Rest,
                  `${Current}${Char}`,
                  false,
                  Result,
                  Depth
                >
            : // Regular character - add to current field and continue
              SplitFieldsRespectingQuotes<
                Rest,
                `${Current}${Char}`,
                false,
                Result,
                Depth
              >
  : // End of string reached
    Current extends ''
    ? Result // Current field is empty, return accumulated result
    : [...Result, Current]; // Add final field to result

/**
 * Convert string array to parsed field objects.
 *
 * Takes the array of field strings produced by SplitFieldsRespectingQuotes
 * and converts each string into a structured field object with name, type, and optional properties.
 *
 * EXAMPLE:
 * Input: ['sourceType:class "class1, class2, class3"', 'relevantContext:string', 'sources:string']
 * Output: [
 *   { name: 'sourceType', type: 'class|class1, class2, class3', optional: false },
 *   { name: 'relevantContext', type: 'string', optional: false },
 *   { name: 'sources', type: 'string', optional: false }
 * ]
 */
type StringArrayToFields<T extends readonly string[]> = T extends readonly [
  infer First,
  ...infer Rest,
]
  ? First extends string
    ? Rest extends readonly string[]
      ? [ParseNameAndType<Trim<First>>, ...StringArrayToFields<Rest>]
      : [ParseNameAndType<Trim<First>>]
    : []
  : [];

/**
 * Main field parser using the quote-aware splitter.
 *
 * This is the entry point for parsing a field list string into typed field objects.
 * It combines the quote-aware splitting with field object conversion to produce
 * the final tuple that BuildObject can use for type inference.
 *
 * FLOW:
 * 1. SplitFieldsRespectingQuotes: 'field1, field2' -> ['field1', 'field2']
 * 2. StringArrayToFields: ['field1', 'field2'] -> [FieldObj1, FieldObj2]
 * 3. BuildObject: [FieldObj1, FieldObj2] -> { field1: Type1, field2: Type2 }
 */
type ParseFields<S extends string> = StringArrayToFields<
  SplitFieldsRespectingQuotes<S>
>;

/**
 * Builds a TypeScript object type from a readonly tuple of field definitions,
 * supporting both required and optional fields.
 */
export type BuildObject<
  T extends readonly {
    name: string;
    type: string;
    optional: boolean;
    internal?: boolean;
  }[],
  TMode extends 'input' | 'output' = 'input',
> = {
  // Map required properties (exclude internal fields)
  -readonly [K in T[number] as K['internal'] extends true
    ? never
    : K['optional'] extends false
      ? K['name']
      : never]: ResolveType<K['type'], TMode>;
} & {
  // Map optional properties (exclude internal fields)
  -readonly [K in T[number] as K['internal'] extends true
    ? never
    : K['optional'] extends true
      ? K['name']
      : never]?: ResolveType<K['type'], TMode>;
};

// Whitespace accepted around the `->` separator and after a leading
// description. Mirrors the runtime parser, which calls skipWhitespace() at
// each of those spots, so multiline signatures may break the line there.
type ArrowWhitespace = ' ' | '\n' | '\t' | '\r';

// Helper to strip signature description if present. Any whitespace may follow
// the closing quote (as at runtime), e.g. a description on its own line.
type StripSignatureDescription<S extends string> =
  S extends `"${infer _Desc}"${ArrowWhitespace}${infer Rest}` ? Trim<Rest> : S;

/**
 * Splits a signature at the first `->` that has whitespace on both sides.
 *
 * Requiring whitespace keeps arrows inside quoted text (class options or
 * descriptions like `class "a->b"`) from being mistaken for the separator.
 * Occurrences without surrounding whitespace are skipped and the scan resumes
 * after them, accumulating the consumed text in Prefix.
 *
 * Resolves to [inputs, outputs] on success, or null when no separator exists.
 */
type SplitOnArrow<
  S extends string,
  Prefix extends string = '',
> = S extends `${infer Before}->${infer After}`
  ? Before extends `${string}${ArrowWhitespace}`
    ? After extends `${ArrowWhitespace}${string}`
      ? [`${Prefix}${Before}`, After]
      : SplitOnArrow<After, `${Prefix}${Before}->`>
    : SplitOnArrow<After, `${Prefix}${Before}->`>
  : null;

/**
 * The main signature parser that handles the complete parsing pipeline.
 *
 * This is the top-level type that users interact with. It takes a signature string
 * and produces TypeScript types for both inputs and outputs with proper type inference.
 *
 * SIGNATURE FORMAT:
 * "[description] inputField1:type1, inputField2:type2 -> outputField1:type1, outputField2:type2"
 *
 * EXAMPLES:
 * Simple: 'userQuery:string -> response:string'
 * Complex: 'searchQuery:string -> sourceType:class "class1, class2, class3", context:string'
 * With description: '"Analyze text" text:string -> sentiment:class "positive, negative", confidence:number'
 *
 * PROCESSING STEPS:
 * 1. StripSignatureDescription: Remove optional description at start
 * 2. SplitOnArrow: Split on whitespace-surrounded "->" to separate inputs
 *    from outputs (any of space/newline/tab counts, as at runtime)
 * 3. ParseFields: Use quote-aware parsing for both input and output field lists
 * 4. BuildObject: Convert field tuples to TypeScript object types
 *
 * RESULT TYPE:
 * {
 *   inputs: { [fieldName]: FieldType },
 *   outputs: { [fieldName]: FieldType }
 * }
 *
 * Where FieldType is inferred from the signature (string, number, 'option1'|'option2', etc.)
 */
export type ParseSignature<S extends string> = SplitOnArrow<
  StripSignatureDescription<Trim<S>>
> extends [infer Inputs extends string, infer Outputs extends string]
  ? {
      inputs: BuildObject<ParseFields<Trim<Inputs>>, 'input'>;
      outputs: BuildObject<ParseFields<Trim<Outputs>>, 'output'>;
    }
  : { inputs: Record<string, any>; outputs: Record<string, any> }; // Fallback for invalid format
