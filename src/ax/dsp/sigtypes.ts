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
// - Basic types: string, number, boolean, json, date, datetime, image, audio, file, url, code
// - Array types: string[], number[], boolean[], etc.
// - Class types with comma-separated options: class "option1, option2, option3" 
// - Optional fields: fieldName?:type
// - Field descriptions: fieldName:type "description"
// - Signature descriptions: "description" inputs -> outputs
// - Multi-field input/output signatures
// - Complex nested comma handling in quoted strings
//
// LIMITATIONS:
// - TypeScript's template literal type system has recursion and complexity limits
// - Very long signatures (>50 fields) may hit TypeScript compiler limits
// - Internal markers (!) are not supported in type inference (runtime only)
// - Deeply nested quote escaping is not supported
//
// PERFORMANCE:
// - Optimized for common cases (1-10 fields per signature)
// - State machine approach is efficient for TypeScript's type checker
// - Falls back gracefully for edge cases that exceed compiler limits
//
// For full feature support and complex signatures, the runtime parser in parser.ts
// provides complete functionality. This type system provides compile-time inference
// for the vast majority of real-world use cases.

/**
 * A map of string type names to their corresponding TypeScript types.
 * Maps signature type strings to actual TypeScript types for type inference.
 */
export interface TypeMap {
  string: string;
  number: number;
  boolean: boolean;
  json: any;
  date: Date;
  datetime: Date;
  image: { mimeType: string; data: string };
  audio: { format?: 'wav'; data: string };
  file: { mimeType: string; data: string };
  url: string;
  code: string;
}

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
type ResolveType<T extends string> = T extends keyof TypeMap
  ? TypeMap[T]
  : T extends `${infer BaseType}[]`
    ? BaseType extends keyof TypeMap
      ? TypeMap[BaseType][]
      : any[]
    : T extends `class[]|${infer Options}`
      ? ParseClassOptions<Options>[]
    : T extends `class|${infer Options}`
      ? ParseClassOptions<Options>
      : T extends 'class'
        ? string // fallback for class without options
        : any; // fallback for unknown types

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

// Parses a single field, checking for the optional marker "?" at the end of the name
type ParseField<S extends string> = S extends `${infer Name}?`
  ? { name: Trim<Name>; optional: true }
  : { name: Trim<S>; optional: false };

// Helper to extract type from a string, handling class with descriptions
type ExtractType<S extends string> = 
  S extends `class[] "${infer Options}" "${infer _Desc}"`
    ? `class[]|${Options}`
    : S extends `class[] "${infer Options}"`
      ? `class[]|${Options}`
    : S extends `class "${infer Options}" "${infer _Desc}"`
      ? `class|${Options}`
    : S extends `class "${infer Options}"`
      ? `class|${Options}`
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
  Current extends string = "",
  InQuote extends boolean = false,
  Result extends string[] = []
> = S extends `${infer Char}${infer Rest}`
  ? Char extends '"'
    ? // Found a quote character - toggle the quote state
      // Add the quote to current field and flip InQuote boolean
      SplitFieldsRespectingQuotes<Rest, `${Current}${Char}`, InQuote extends true ? false : true, Result>
    : Char extends ','
      ? InQuote extends true
        ? // We're inside quotes - treat comma as a literal character
          // Add comma to current field and continue in same quote state
          SplitFieldsRespectingQuotes<Rest, `${Current}${Char}`, InQuote, Result>
        : // We're outside quotes - this comma is a field separator
          // Complete current field and start building next field
          Rest extends ` ${infer RestTrimmed}`
            ? // Handle ", " (comma + space) separator - skip the space
              SplitFieldsRespectingQuotes<RestTrimmed, "", false, [...Result, Current]>
            : // Handle "," (comma only) separator
              SplitFieldsRespectingQuotes<Rest, "", false, [...Result, Current]>
      : // Regular character (not quote or comma)
        // Add character to current field and continue
        SplitFieldsRespectingQuotes<Rest, `${Current}${Char}`, InQuote, Result>
  : // End of string reached
    Current extends ""
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
type StringArrayToFields<T extends readonly string[]> = T extends readonly [infer First, ...infer Rest]
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
type ParseFields<S extends string> = StringArrayToFields<SplitFieldsRespectingQuotes<S>>;

/**
 * Builds a TypeScript object type from a readonly tuple of field definitions,
 * supporting both required and optional fields.
 */
export type BuildObject<
  T extends readonly { name: string; type: string; optional: boolean }[],
> = {
  // Map required properties
  -readonly [K in T[number] as K['optional'] extends false
    ? K['name']
    : never]: ResolveType<K['type']>;
} & {
  // Map optional properties
  -readonly [K in T[number] as K['optional'] extends true
    ? K['name']
    : never]?: ResolveType<K['type']>;
};

// Helper to strip signature description if present
type StripSignatureDescription<S extends string> = 
  S extends `"${infer _Desc}" ${infer Rest}`
    ? Trim<Rest>
    : S;

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
 * 2. Split on " -> " to separate inputs from outputs  
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
export type ParseSignature<S extends string> = 
  StripSignatureDescription<Trim<S>> extends `${infer Inputs} -> ${infer Outputs}`
    ? {
        inputs: BuildObject<ParseFields<Trim<Inputs>>>;
        outputs: BuildObject<ParseFields<Trim<Outputs>>>;
      }
    : { inputs: Record<string, any>; outputs: Record<string, any> }; // Fallback for invalid format
