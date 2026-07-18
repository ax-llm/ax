// ============================================================================
// STRING SIGNATURE PARSER - TYPE DEFINITIONS
// ============================================================================
//
// ✅ Supported:
//   - Primitives: string, number, boolean
//   - Arrays: string[], number[], boolean[]
//   - Special types: json, date, datetime, dateRange, datetimeRange, url, code, file, image, audio
//   - Class enums: class "option1, option2, option3"
//   - Modifier bags after a type: string(min 2, max 50), number(min 0),
//     string(format email), string(pattern "^[a-z]+$" "lowercase word"),
//     code(python), tags:string(item "a short tag")[], contextText:string(cache)
//   - Nested objects with structured fields: object{ name:string, age?:number }
//     and arrays of objects: object{ ... }[]
//
// ❌ NOT Supported:
//   - Standard Schema (zod/valibot) fields — use the fluent API for those
//   - Media types (image, audio, file) inside object{ ... }
//   - Internal markers (!) inside object{ ... }
//
// The string API is the strict surface: modifiers that don't apply to a type
// are hard errors here, whereas the fluent API silently ignores them.
//
// ============================================================================

export type TypeNotClass =
  | 'string'
  | 'number'
  | 'boolean'
  | 'json' // Flexible type - inferred as 'any', accepts any JSON
  | 'image'
  | 'audio'
  | 'file'
  | 'url'
  | 'dateRange'
  | 'datetimeRange'
  | 'datetime'
  | 'date'
  | 'code'
  | 'object'; // Flexible type - inferred as 'any', same as 'json'

export type Type = TypeNotClass | 'class';
export type ParsedIdentifier = string;
export type ParsedString = string;

export type ParsedSignature = {
  desc?: string;
  inputs: InputParsedField[];
  outputs: OutputParsedField[];
};

// Validation constraints and metadata parsed from a type modifier bag,
// e.g. `string(min 2, max 50)`, `string(format email)` or `code(python)`.
// Keys mirror the constraint slots on AxFieldType/AxField in sig.ts.
export type ParsedTypeConstraints = {
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  patternDescription?: string;
  format?: string;
  language?: string;
};

// A field type inside `object{ ... }`. Structurally compatible with
// AxFieldType in sig.ts, which cannot be imported here without a cycle.
export type ParsedNestedFieldType = ParsedTypeConstraints & {
  type: TypeNotClass | 'class';
  isArray: boolean;
  options?: string[];
  fields?: Record<string, ParsedNestedFieldType>;
  description?: string;
  isOptional: boolean;
  isInternal: boolean;
};

// Shared shape of a parsed top-level (non-class) field type. Structurally
// compatible with AxField['type'] so it can be passed through unchanged.
// `description` holds the per-item description for arrays (`item "..."`).
export type ParsedFieldType = ParsedTypeConstraints & {
  name: TypeNotClass;
  isArray: boolean;
  fields?: Record<string, ParsedNestedFieldType>;
  description?: string;
};

export type InputParsedField = {
  name: ParsedIdentifier;
  desc?: string;
  type?: ParsedFieldType;
  isOptional?: boolean;
  isCached?: boolean;
};

export type OutputParsedField = {
  name: ParsedIdentifier;
  desc?: string;
  type?:
    | (ParsedFieldType & { options?: string[] })
    | { name: 'class'; isArray: boolean; options: string[] };
  isOptional?: boolean;
  isInternal?: boolean;
};

import { axGlobals } from './globals.js';

class SignatureValidationError extends Error {
  constructor(
    message: string,
    public readonly position: number,
    public readonly context: string,
    public readonly suggestion?: string
  ) {
    super(message);
    this.name = 'SignatureValidationError';
  }
}

class SignatureParser {
  private input: string;
  private position: number;
  private currentFieldName: string | null = null;
  private currentSection: 'description' | 'inputs' | 'outputs' = 'description';

  constructor(input: string) {
    this.input = input.trim();
    this.position = 0;

    if (!this.input) {
      throw new SignatureValidationError(
        'Empty signature provided',
        0,
        '',
        'A signature must contain at least input and output fields separated by "->". Example: "userQuery:string -> aiResponse:string"'
      );
    }
  }

  parse(): ParsedSignature {
    try {
      this.skipWhitespace();
      const optionalDesc = this.parseParsedString();
      this.skipWhitespace();

      this.currentSection = 'inputs';
      // Use the specialized input field parser
      const inputs = this.parseFieldList<InputParsedField>(
        () => this.parseInputField(),
        'input'
      );
      this.skipWhitespace();

      if (this.position >= this.input.length) {
        throw new SignatureValidationError(
          'Incomplete signature: Missing output section',
          this.position,
          this.getErrorContext(),
          'Add "->" followed by output fields. Example: "-> responseText:string"'
        );
      }

      this.expectArrow();
      this.skipWhitespace();

      if (this.position >= this.input.length) {
        throw new SignatureValidationError(
          'Incomplete signature: No output fields specified after "->"',
          this.position,
          this.getErrorContext(),
          'Add at least one output field. Example: "-> responseText:string"'
        );
      }

      this.currentSection = 'outputs';
      // Use the specialized output field parser
      const outputs = this.parseFieldList<OutputParsedField>(
        () => this.parseOutputField(),
        'output'
      );

      // Check for any remaining content that shouldn't be there
      this.skipWhitespace();
      if (this.position < this.input.length) {
        const remaining = this.input.slice(this.position);
        throw new SignatureValidationError(
          `Unexpected content after signature: "${remaining}"`,
          this.position,
          this.getErrorContext(),
          'Remove any extra content after the output fields'
        );
      }

      // Validate the parsed signature
      this.validateParsedSignature({
        desc: optionalDesc?.trim(),
        inputs,
        outputs,
      });

      return {
        desc: optionalDesc?.trim(),
        inputs,
        outputs,
      };
    } catch (error) {
      if (error instanceof SignatureValidationError) {
        throw error;
      }

      // Wrap other errors with better context
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      throw new SignatureValidationError(
        errorMessage,
        this.position,
        this.getErrorContext()
      );
    }
  }

  private validateParsedSignature(signature: Readonly<ParsedSignature>): void {
    // Check for duplicate field names within inputs
    const inputNames = new Set<string>();
    for (const field of signature.inputs) {
      if (inputNames.has(field.name)) {
        throw new SignatureValidationError(
          `Duplicate input field name: "${field.name}"`,
          0,
          '',
          'Each field name must be unique within the signature'
        );
      }
      inputNames.add(field.name);
    }

    // Check for duplicate field names within outputs
    const outputNames = new Set<string>();
    for (const field of signature.outputs) {
      if (outputNames.has(field.name)) {
        throw new SignatureValidationError(
          `Duplicate output field name: "${field.name}"`,
          0,
          '',
          'Each field name must be unique within the signature'
        );
      }
      outputNames.add(field.name);
    }

    // Check for field names that appear in both inputs and outputs
    for (const outputField of signature.outputs) {
      if (inputNames.has(outputField.name)) {
        throw new SignatureValidationError(
          `Field name "${outputField.name}" appears in both inputs and outputs`,
          0,
          '',
          'Use different names for input and output fields to avoid confusion'
        );
      }
    }

    // Validate that we have at least one input and one output
    if (signature.inputs.length === 0) {
      throw new SignatureValidationError(
        'Signature must have at least one input field',
        0,
        '',
        'Add an input field before "->". Example: "userInput:string -> ..."'
      );
    }

    if (signature.outputs.length === 0) {
      throw new SignatureValidationError(
        'Signature must have at least one output field',
        0,
        '',
        'Add an output field after "->". Example: "... -> responseText:string"'
      );
    }
  }

  private getErrorContext(): string {
    const start = Math.max(0, this.position - 25);
    const end = Math.min(this.input.length, this.position + 25);
    const before = this.input.slice(start, this.position);
    const after = this.input.slice(this.position, end);
    const pointer = `${' '.repeat(before.length)}^`;

    const lines = [
      `Position ${this.position} in signature:`,
      `"${before}${after}"`,
      ` ${pointer}`,
    ];

    return lines.join('\n');
  }

  private parseFieldList<T extends InputParsedField | OutputParsedField>(
    parseFieldFn: () => T,
    section: 'input' | 'output'
  ): T[] {
    const fields: T[] = [];
    this.skipWhitespace();

    if (this.position >= this.input.length) {
      throw new SignatureValidationError(
        `Empty ${section} section: Expected at least one field`,
        this.position,
        this.getErrorContext(),
        `Add a ${section} field. Example: ${section === 'input' ? 'userInput:string' : 'responseText:string'}`
      );
    }

    // Parse first field
    try {
      fields.push(parseFieldFn());
    } catch (error) {
      if (error instanceof SignatureValidationError) {
        throw error;
      }
      throw new SignatureValidationError(
        `Invalid first ${section} field: ${error instanceof Error ? error.message : 'Unknown error'}`,
        this.position,
        this.getErrorContext()
      );
    }

    this.skipWhitespace();

    // Parse remaining fields
    while (this.position < this.input.length) {
      if (
        this.input[this.position] === '-' &&
        this.position + 1 < this.input.length &&
        this.input[this.position + 1] === '>'
      ) {
        break;
      }

      if (this.match(',')) {
        this.skipWhitespace();
        if (this.position >= this.input.length) {
          throw new SignatureValidationError(
            `Unexpected end of input after comma in ${section} section`,
            this.position,
            this.getErrorContext(),
            `Add another ${section} field after the comma`
          );
        }
        try {
          fields.push(parseFieldFn());
        } catch (error) {
          if (error instanceof SignatureValidationError) {
            throw error;
          }
          throw new SignatureValidationError(
            `Invalid ${section} field after comma: ${error instanceof Error ? error.message : 'Unknown error'}`,
            this.position,
            this.getErrorContext()
          );
        }
        this.skipWhitespace();
      } else {
        break;
      }
    }

    return fields;
  }

  // -------------------------------
  // Parse input fields (no "class" type and no internal flag)
  // -------------------------------
  private parseInputField(): InputParsedField {
    this.skipWhitespace();
    const name = this.parseParsedIdentifier();
    this.currentFieldName = name;

    // Validate field name for inputs
    this.validateFieldName(name, 'input');

    // Only the optional marker is allowed
    let isOptional: boolean | undefined;
    while (true) {
      if (this.match('?')) {
        isOptional = true;
        continue;
      }
      if (this.match('!')) {
        throw new SignatureValidationError(
          `Input field "${name}" cannot use the internal marker "!"`,
          this.position - 1,
          this.getErrorContext(),
          'Internal markers (!) are only allowed on output fields'
        );
      }
      break;
    }

    let type: ParsedFieldType | undefined;
    let isCached: boolean | undefined;
    this.skipWhitespace();
    if (this.match(':')) {
      this.skipWhitespace();
      // Disallow the "class" type in input fields
      if (/^class\b/.test(this.input.slice(this.position))) {
        throw new SignatureValidationError(
          `Input field "${name}" cannot use the "class" type`,
          this.position,
          this.getErrorContext(),
          'Class types are only allowed on output fields. Use "string" type for input classifications'
        );
      }
      try {
        const parsed = this.parseNonClassType('input', name);
        type = parsed.type;
        isCached = parsed.isCached;
      } catch (error) {
        if (error instanceof SignatureValidationError) {
          throw error;
        }
        throw new SignatureValidationError(
          `Input field "${name}": ${error instanceof Error ? error.message : 'Unknown error'}`,
          this.position,
          this.getErrorContext()
        );
      }
    }

    this.skipWhitespace();
    const desc = this.parseParsedString()?.trim();

    return {
      name,
      // A code field's language doubles as its description when no explicit
      // description is given, mirroring f.code(language).
      desc: desc ?? (type?.name === 'code' ? type.language : undefined),
      type,
      isOptional,
      ...(isCached ? { isCached: true } : {}),
    };
  }

  // -------------------------------
  // Parse output fields (supports both "class" type and the internal marker)
  // -------------------------------
  private parseOutputField(): OutputParsedField {
    this.skipWhitespace();
    const name = this.parseParsedIdentifier();
    this.currentFieldName = name;

    // Validate field name for outputs
    this.validateFieldName(name, 'output');

    let isOptional = false;
    let isInternal = false;
    while (true) {
      if (this.match('?')) {
        isOptional = true;
        continue;
      }
      if (this.match('!')) {
        isInternal = true;
        continue;
      }
      break;
    }

    let type: OutputParsedField['type'];
    this.skipWhitespace();
    if (this.match(':')) {
      this.skipWhitespace();
      if (this.match('class')) {
        this.rejectClassModifierBag(name);
        const isArray = this.match('[]');
        this.rejectClassModifierBag(name);
        this.skipWhitespace();
        const classNamesString = this.parseParsedString();
        if (!classNamesString) {
          throw new SignatureValidationError(
            `Output field "${name}": Missing class options after "class" type`,
            this.position,
            this.getErrorContext(),
            'Add class names in quotes. Example: class "positive, negative, neutral"'
          );
        }
        const options = classNamesString
          .split(/[,|]/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        if (options.length === 0) {
          throw new SignatureValidationError(
            `Output field "${name}": Empty class list provided`,
            this.position,
            this.getErrorContext(),
            'Provide at least one class option. Example: "positive, negative"'
          );
        }

        type = { name: 'class', isArray, options };
      } else {
        try {
          const parsed = this.parseNonClassType('output', name);
          type = parsed.type;
          const typeName = type.name;
          const isArray = type.isArray;

          // Validate specific type constraints
          if (typeName === 'image' && isArray) {
            throw new SignatureValidationError(
              `Output field "${name}": Arrays of images are not supported`,
              this.position,
              this.getErrorContext(),
              'Use a single image type instead: "image"'
            );
          }

          if (typeName === 'audio' && isArray) {
            throw new SignatureValidationError(
              `Output field "${name}": Arrays of audio are not supported`,
              this.position,
              this.getErrorContext(),
              'Use a single audio type instead: "audio"'
            );
          }

          if (typeName === 'image') {
            throw new SignatureValidationError(
              `Output field "${name}": Image type is not supported in output fields`,
              this.position,
              this.getErrorContext(),
              'Image types can only be used in input fields'
            );
          }
        } catch (error) {
          if (error instanceof SignatureValidationError) {
            throw error;
          }
          throw new SignatureValidationError(
            `Output field "${name}": ${error instanceof Error ? error.message : 'Unknown error'}`,
            this.position,
            this.getErrorContext()
          );
        }
      }
    }

    this.skipWhitespace();
    const desc = this.parseParsedString()?.trim();

    return {
      name,
      desc: desc ?? (type?.name === 'code' ? type.language : undefined),
      type,
      isOptional,
      isInternal,
    };
  }

  private validateFieldName(name: string, fieldType: 'input' | 'output'): void {
    // Check for reserved/generic names that should be more descriptive
    if (axGlobals.signatureStrict) {
      const reservedNames = [
        'text',
        'object',
        'image',
        'string',
        'number',
        'boolean',
        'json',
        'array',
        'daterange',
        'datetimerange',
        'datetime',
        'date',
        'time',
        'type',
        'class',
        'input',
        'output',
        'data',
        'value',
        'result',
        'response',
        'request',
        'item',
        'element',
      ];

      if (reservedNames.includes(name.toLowerCase())) {
        const suggestions =
          fieldType === 'input'
            ? ['userInput', 'questionText', 'documentContent', 'messageText']
            : ['responseText', 'analysisResult', 'categoryType', 'summaryText'];

        throw new SignatureValidationError(
          `Field name "${name}" is too generic`,
          this.position,
          this.getErrorContext(),
          `Use a more descriptive name. Examples: ${suggestions.join(', ')}`
        );
      }
    }

    // Check naming convention
    const camelCaseRegex = /^[a-z][a-zA-Z0-9]*$/;
    const snakeCaseRegex = /^[a-z]+(_[a-z0-9]+)*$/;

    if (!camelCaseRegex.test(name) && !snakeCaseRegex.test(name)) {
      throw new SignatureValidationError(
        `Invalid field name "${name}"`,
        this.position,
        this.getErrorContext(),
        'Field names must be in camelCase (e.g., "userInput") or snake_case (e.g., "user_input")'
      );
    }

    // Check for minimum length
    if (name.length < 2) {
      throw new SignatureValidationError(
        `Field name "${name}" is too short`,
        this.position,
        this.getErrorContext(),
        'Field names must be at least 2 characters long'
      );
    }

    // Check for maximum length
    if (name.length > 50) {
      throw new SignatureValidationError(
        `Field name "${name}" is too long (${name.length} characters)`,
        this.position,
        this.getErrorContext(),
        'Field names should be 50 characters or less'
      );
    }
  }

  private parseTypeNotClass(): TypeNotClass {
    const types: TypeNotClass[] = [
      'string',
      'number',
      'boolean',
      'json',
      'image',
      'audio',
      'file',
      'url',
      'datetimeRange',
      'dateRange',
      'datetime',
      'date',
      'code',
      'object',
    ];

    // Match the whole word so "stringy" is rejected instead of half-matching
    // as "string" followed by junk.
    const word = /^[a-zA-Z][a-zA-Z0-9]*/.exec(
      this.input.slice(this.position)
    )?.[0];
    if (word && (types as string[]).includes(word)) {
      this.position += word.length;
      return word as TypeNotClass;
    }

    const currentWord =
      word ?? (this.input.slice(this.position).match(/^\w+/)?.[0] || '');
    const suggestion = this.suggestType(currentWord);

    const baseMessage = `Invalid type "${currentWord || 'empty'}"`;
    const suggestionPart = suggestion ? `. Did you mean "${suggestion}"?` : '';
    const fullMessage = `${baseMessage}${suggestionPart}`;

    throw new SignatureValidationError(
      fullMessage,
      this.position,
      this.getErrorContext(),
      `Expected one of: ${types.join(', ')}`
    );
  }

  private suggestType(input: string): string | null {
    const suggestions: Record<string, string> = {
      str: 'string',
      text: 'string',
      int: 'number',
      integer: 'number',
      float: 'number',
      double: 'number',
      bool: 'boolean',
      object: 'json',
      dict: 'json',
      daterange: 'dateRange',
      range: 'datetimeRange',
      datetimerange: 'datetimeRange',
      timestamp: 'datetime',
      time: 'datetime',
      img: 'image',
      picture: 'image',
      sound: 'audio',
      voice: 'audio',
      classification: 'class',
      category: 'class',
    };

    return suggestions[input.toLowerCase()] || null;
  }

  private rejectClassModifierBag(fieldName: string): void {
    if (this.input[this.position] === '(') {
      throw new SignatureValidationError(
        `Field "${fieldName}": constraints are not supported on class fields`,
        this.position,
        this.getErrorContext(),
        'Class options use a quoted string. Example: class "positive, negative"'
      );
    }
  }

  // Parses a non-class type expression: a base type followed by an optional
  // modifier bag `(...)`, an optional `{...}` field list for objects, and an
  // optional `[]` array suffix.
  private parseNonClassType(
    section: 'input' | 'output' | 'nested',
    fieldName: string
  ): { type: ParsedFieldType; isCached?: boolean } {
    const typeName = this.parseTypeNotClass();

    if (typeName === 'object') {
      const beforeBrace = this.position;
      this.skipWhitespace();
      if (this.match('{')) {
        const fields = this.parseObjectFields(fieldName);
        const isArray = this.match('[]');
        return { type: { name: 'object', isArray, fields } };
      }
      // Bare `object` without braces stays a flexible json-like type.
      this.position = beforeBrace;
    }

    let constraints: ParsedTypeConstraints = {};
    let isCached: boolean | undefined;
    let itemDescription: string | undefined;
    if (this.input[this.position] === '(') {
      const bag = this.parseModifierBag(typeName, section, fieldName);
      constraints = bag.constraints;
      isCached = bag.isCached;
      itemDescription = bag.itemDescription;
    }

    const isArray = this.match('[]');
    if (itemDescription !== undefined && !isArray) {
      throw new SignatureValidationError(
        `Field "${fieldName}": the "item" modifier requires an array type`,
        this.position,
        this.getErrorContext(),
        'Add "[]" after the modifier list. Example: tags:string(item "a short tag")[]'
      );
    }

    return {
      type: {
        name: typeName,
        isArray,
        ...constraints,
        ...(itemDescription !== undefined
          ? { description: itemDescription }
          : {}),
      },
      ...(isCached ? { isCached: true } : {}),
    };
  }

  // Parses `(entry, entry, ...)` after a base type. The opening "(" has NOT
  // been consumed yet. Modifiers that don't apply to the base type are hard
  // errors — the string API is the strict surface.
  private parseModifierBag(
    typeName: TypeNotClass,
    section: 'input' | 'output' | 'nested',
    fieldName: string
  ): {
    constraints: ParsedTypeConstraints;
    isCached?: boolean;
    itemDescription?: string;
  } {
    this.position++; // consume '('
    const constraints: ParsedTypeConstraints = {};
    let isCached: boolean | undefined;
    let itemDescription: string | undefined;
    const seen = new Set<string>();

    const allowedForType = (): string => {
      const allowed: string[] = [];
      if (typeName === 'string') {
        allowed.push(
          'min <n>',
          'max <n>',
          'format <email|uri|date|date-time>',
          'pattern "<regex>"'
        );
      }
      if (typeName === 'number') {
        allowed.push('min <n>', 'max <n>');
      }
      if (typeName === 'code') {
        allowed.push('<language>');
      }
      if (section !== 'nested') {
        allowed.push('item "<description>"');
      }
      if (section === 'input') {
        allowed.push('cache');
      }
      return allowed.length > 0
        ? allowed.join(', ')
        : 'no modifiers apply to this type here';
    };

    const bagError = (message: string, suggestion?: string): never => {
      throw new SignatureValidationError(
        message,
        this.position,
        this.getErrorContext(),
        suggestion
      );
    };

    const markSeen = (key: string): void => {
      if (seen.has(key)) {
        bagError(
          `Field "${fieldName}": duplicate "${key}" modifier`,
          'Each modifier may appear at most once per field'
        );
      }
      seen.add(key);
    };

    this.skipWhitespace();
    if (this.match(')')) {
      bagError(
        `Field "${fieldName}": empty modifier list "()"`,
        `Remove the parentheses or add a modifier. Allowed here: ${allowedForType()}`
      );
    }

    while (true) {
      this.skipWhitespace();
      const token = /^[a-zA-Z][a-zA-Z0-9+#.-]*/.exec(
        this.input.slice(this.position)
      )?.[0];
      if (!token) {
        bagError(
          `Field "${fieldName}": expected a modifier name inside "(...)"`,
          `Allowed here: ${allowedForType()}`
        );
        break; // unreachable, keeps TS narrowing simple
      }
      this.position += token.length;

      switch (token) {
        case 'min':
        case 'max': {
          markSeen(token);
          if (typeName !== 'string' && typeName !== 'number') {
            bagError(
              `Field "${fieldName}": "${token}" is not supported for type "${typeName}"`,
              `"${token}" applies to string (length) and number (value) fields only`
            );
          }
          this.skipWhitespace();
          const num = /^-?\d+(\.\d+)?/.exec(
            this.input.slice(this.position)
          )?.[0];
          if (!num) {
            bagError(
              `Field "${fieldName}": "${token}" requires a numeric value`,
              `Example: ${token} ${token === 'min' ? '0' : '100'}`
            );
            break;
          }
          this.position += num.length;
          const value = Number(num);
          if (typeName === 'string') {
            if (token === 'min') {
              constraints.minLength = value;
            } else {
              constraints.maxLength = value;
            }
          } else if (token === 'min') {
            constraints.minimum = value;
          } else {
            constraints.maximum = value;
          }
          break;
        }
        case 'format': {
          markSeen('format');
          if (typeName !== 'string') {
            bagError(
              `Field "${fieldName}": "format" is not supported for type "${typeName}"`,
              '"format" applies to string fields only'
            );
          }
          this.skipWhitespace();
          const formats = ['email', 'uri', 'date-time', 'date'];
          const fmt = /^[a-z-]+/.exec(this.input.slice(this.position))?.[0];
          if (!fmt || !formats.includes(fmt)) {
            bagError(
              `Field "${fieldName}": unknown format "${fmt ?? ''}"`,
              `Expected one of: ${formats.join(', ')}`
            );
            break;
          }
          this.position += fmt.length;
          constraints.format = fmt;
          break;
        }
        case 'pattern': {
          markSeen('pattern');
          if (typeName !== 'string') {
            bagError(
              `Field "${fieldName}": "pattern" is not supported for type "${typeName}"`,
              '"pattern" applies to string fields only'
            );
          }
          this.skipWhitespace();
          const pattern = this.parseParsedString();
          if (pattern === undefined) {
            bagError(
              `Field "${fieldName}": "pattern" requires a quoted regular expression`,
              'Example: pattern "^[A-Z]{3}-\\\\d+$" "three capitals, a dash, digits" (backslashes are escaped inside quotes)'
            );
            break;
          }
          constraints.pattern = pattern;
          this.skipWhitespace();
          const patternDesc = this.parseParsedString();
          if (patternDesc !== undefined) {
            constraints.patternDescription = patternDesc;
          }
          break;
        }
        case 'cache': {
          markSeen('cache');
          if (section !== 'input') {
            bagError(
              `Field "${fieldName}": "cache" is only supported on top-level input fields`,
              section === 'nested'
                ? 'Move the cache modifier to the enclosing top-level input field'
                : 'Remove "cache" from this output field'
            );
          }
          isCached = true;
          break;
        }
        case 'item': {
          markSeen('item');
          if (section === 'nested') {
            bagError(
              `Field "${fieldName}": "item" is not supported inside object fields`,
              'Use a field description instead'
            );
          }
          this.skipWhitespace();
          const itemDesc = this.parseParsedString();
          if (itemDesc === undefined) {
            bagError(
              `Field "${fieldName}": "item" requires a quoted description`,
              'Example: tags:string(item "a short tag")[]'
            );
            break;
          }
          itemDescription = itemDesc;
          break;
        }
        default: {
          if (typeName === 'code') {
            markSeen('language');
            constraints.language = token;
          } else {
            bagError(
              `Field "${fieldName}": unknown modifier "${token}" for type "${typeName}"`,
              `Allowed here: ${allowedForType()}`
            );
          }
        }
      }

      this.skipWhitespace();
      if (this.match(',')) {
        this.skipWhitespace();
        if (this.input[this.position] === ')') {
          bagError(
            `Field "${fieldName}": trailing comma in modifier list`,
            'Remove the comma before ")"'
          );
        }
        continue;
      }
      if (this.match(')')) {
        break;
      }
      bagError(
        `Field "${fieldName}": expected "," or ")" in modifier list`,
        'Separate modifiers with commas and close the list with ")"'
      );
    }

    return { constraints, isCached, itemDescription };
  }

  // Parses the field list of `object{ ... }`. The opening "{" has already
  // been consumed by the caller.
  private parseObjectFields(
    parentFieldName: string
  ): Record<string, ParsedNestedFieldType> {
    const fields: Record<string, ParsedNestedFieldType> = {};

    this.skipWhitespace();
    if (this.match('}')) {
      throw new SignatureValidationError(
        `Field "${parentFieldName}": object type requires at least one field`,
        this.position - 1,
        this.getErrorContext(),
        'Add fields inside the braces. Example: object{ name:string, age:number }'
      );
    }

    while (true) {
      if (this.position >= this.input.length) {
        throw new SignatureValidationError(
          `Field "${parentFieldName}": unbalanced "{" in object type`,
          this.position,
          this.getErrorContext(),
          'Close the object field list with "}"'
        );
      }

      const [nestedName, nestedType] = this.parseNestedField(parentFieldName);
      if (Object.hasOwn(fields, nestedName)) {
        throw new SignatureValidationError(
          `Field "${parentFieldName}": duplicate object field name "${nestedName}"`,
          this.position,
          this.getErrorContext(),
          'Each field name must be unique within an object'
        );
      }
      fields[nestedName] = nestedType;

      this.skipWhitespace();
      if (this.match(',')) {
        this.skipWhitespace();
        if (this.input[this.position] === '}') {
          throw new SignatureValidationError(
            `Field "${parentFieldName}": trailing comma in object type`,
            this.position,
            this.getErrorContext(),
            'Remove the comma before "}"'
          );
        }
        continue;
      }
      if (this.match('}')) {
        break;
      }
      throw new SignatureValidationError(
        `Field "${parentFieldName}": ${
          this.position >= this.input.length
            ? 'unbalanced "{" in object type'
            : 'expected "," or "}" in object type'
        }`,
        this.position,
        this.getErrorContext(),
        'Separate object fields with commas and close the list with "}"'
      );
    }

    return fields;
  }

  // Parses one `name?:type "desc"` entry inside `object{ ... }`. Nested field
  // names are only syntax-checked (no reserved-name enforcement) so fluent
  // signatures with keys like "id" or "value" round-trip through toString().
  private parseNestedField(
    parentFieldName: string
  ): [string, ParsedNestedFieldType] {
    this.skipWhitespace();
    const name = this.parseParsedIdentifier();
    const qualified = `${parentFieldName}.${name}`;

    let isOptional = false;
    while (true) {
      if (this.match('?')) {
        isOptional = true;
        continue;
      }
      if (this.match('!')) {
        throw new SignatureValidationError(
          `Object field "${qualified}" cannot use the internal marker "!"`,
          this.position - 1,
          this.getErrorContext(),
          'Internal markers are only allowed on top-level output fields'
        );
      }
      break;
    }

    let type: ParsedNestedFieldType | undefined;
    this.skipWhitespace();
    if (this.match(':')) {
      this.skipWhitespace();
      if (/^class\b/.test(this.input.slice(this.position))) {
        this.match('class');
        this.rejectClassModifierBag(qualified);
        const isArray = this.match('[]');
        this.rejectClassModifierBag(qualified);
        this.skipWhitespace();
        const classNamesString = this.parseParsedString();
        if (!classNamesString) {
          throw new SignatureValidationError(
            `Object field "${qualified}": Missing class options after "class" type`,
            this.position,
            this.getErrorContext(),
            'Add class names in quotes. Example: class "high, medium, low"'
          );
        }
        const options = classNamesString
          .split(/[,|]/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        if (options.length === 0) {
          throw new SignatureValidationError(
            `Object field "${qualified}": Empty class list provided`,
            this.position,
            this.getErrorContext(),
            'Provide at least one class option. Example: "high, medium"'
          );
        }
        type = {
          type: 'class',
          isArray,
          options,
          isOptional,
          isInternal: false,
        };
      } else {
        const typeName = this.parseTypeNotClass();
        if (
          typeName === 'image' ||
          typeName === 'audio' ||
          typeName === 'file'
        ) {
          throw new SignatureValidationError(
            `Object field "${qualified}": ${typeName} type is not allowed in nested object fields`,
            this.position,
            this.getErrorContext(),
            'Media types (image, audio, file) can only be used as top-level input fields'
          );
        }
        if (typeName === 'object') {
          const beforeBrace = this.position;
          this.skipWhitespace();
          if (this.match('{')) {
            const fields = this.parseObjectFields(qualified);
            const isArray = this.match('[]');
            type = {
              type: 'object',
              isArray,
              fields,
              isOptional,
              isInternal: false,
            };
          } else {
            this.position = beforeBrace;
          }
        }
        if (!type) {
          let constraints: ParsedTypeConstraints = {};
          if (this.input[this.position] === '(') {
            constraints = this.parseModifierBag(
              typeName,
              'nested',
              qualified
            ).constraints;
          }
          const isArray = this.match('[]');
          type = {
            type: typeName,
            isArray,
            ...constraints,
            isOptional,
            isInternal: false,
          };
        }
      }
    } else {
      // No type annotation defaults to string, like top-level fields.
      type = { type: 'string', isArray: false, isOptional, isInternal: false };
    }

    this.skipWhitespace();
    const desc = this.parseParsedString()?.trim();
    const description =
      desc ?? (type.type === 'code' ? type.language : undefined);
    if (description !== undefined) {
      type.description = description;
    }

    return [name, type];
  }

  private parseParsedIdentifier(): ParsedIdentifier {
    this.skipWhitespace();
    const match = /^[a-zA-Z_][a-zA-Z_0-9]*/.exec(
      this.input.slice(this.position)
    );
    if (match) {
      this.position += match[0].length;
      return match[0];
    }

    const invalidMatch = /^\S+/.exec(this.input.slice(this.position));
    const invalidId = invalidMatch ? invalidMatch[0] : '';

    if (invalidId === '') {
      throw new SignatureValidationError(
        'Expected field name but found end of input',
        this.position,
        this.getErrorContext(),
        'Add a field name. Field names must start with a letter or underscore'
      );
    }

    if (/^\d/.test(invalidId)) {
      throw new SignatureValidationError(
        `Invalid field name "${invalidId}" - cannot start with a number`,
        this.position,
        this.getErrorContext(),
        'Field names must start with a letter or underscore. Example: "userInput" or "_internal"'
      );
    }

    throw new SignatureValidationError(
      `Invalid field name "${invalidId}"`,
      this.position,
      this.getErrorContext(),
      'Field names must start with a letter or underscore and contain only letters, numbers, or underscores'
    );
  }

  private parseParsedString(): string | undefined {
    const quoteChars = ["'", '"'];
    for (const quoteChar of quoteChars) {
      if (this.match(quoteChar)) {
        let content = '';
        let escaped = false;
        const startPos = this.position - 1;

        while (this.position < this.input.length) {
          const char = this.input[this.position];
          this.position++;
          if (escaped) {
            content += char;
            escaped = false;
          } else if (char === '\\') {
            escaped = true;
          } else if (char === quoteChar) {
            return content;
          } else {
            content += char;
          }
        }

        const partialString = this.input.slice(
          startPos,
          Math.min(this.position, startPos + 20)
        );
        throw new SignatureValidationError(
          `Unterminated string starting at position ${startPos}`,
          startPos,
          this.getErrorContext(),
          `Add closing ${quoteChar} to complete the string: ${partialString}${quoteChar}`
        );
      }
    }
    return undefined;
  }

  private skipWhitespace() {
    const match = /^[\s\t\r\n]+/.exec(this.input.slice(this.position));
    if (match) {
      this.position += match[0].length;
    }
  }

  private match(strOrRegex: string | RegExp): boolean {
    let match: RegExpExecArray | null;
    if (typeof strOrRegex === 'string') {
      if (this.input.startsWith(strOrRegex, this.position)) {
        this.position += strOrRegex.length;
        return true;
      }
    } else {
      match = strOrRegex.exec(this.input.slice(this.position));
      if (match) {
        this.position += match[0].length;
        return true;
      }
    }
    return false;
  }

  private expectArrow() {
    if (!this.match('->')) {
      const found = this.input.slice(this.position, this.position + 10);
      const suggestion = found.includes('>')
        ? 'Use "->" (dash followed by greater-than)'
        : found.includes('-')
          ? 'Add ">" after the dash'
          : 'Add "->" to separate input and output fields';

      throw new SignatureValidationError(
        `Expected "->" but found "${found}..."`,
        this.position,
        this.getErrorContext(),
        suggestion
      );
    }
  }
}

export function parseSignature(input: string): ParsedSignature {
  const parser = new SignatureParser(input);
  return parser.parse();
}
