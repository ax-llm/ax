// Updated type definitions

export type TypeNotClass =
  | 'string'
  | 'number'
  | 'boolean'
  | 'json'
  | 'image'
  | 'audio'
  | 'file'
  | 'url'
  | 'datetime'
  | 'date'
  | 'code';
export type Type = TypeNotClass | 'class';
export type ParsedIdentifier = string;
export type ParsedString = string;

export type ParsedSignature = {
  desc?: string;
  inputs: InputParsedField[];
  outputs: OutputParsedField[];
};

export type InputParsedField = {
  name: ParsedIdentifier;
  desc?: string;
  type?: { name: TypeNotClass; isArray: boolean };
  isOptional?: boolean;
};

export type OutputParsedField = {
  name: ParsedIdentifier;
  desc?: string;
  type?:
    | { name: TypeNotClass; isArray: boolean; options?: string[] }
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
      const inputs = this.parseFieldList(
        this.parseInputField.bind(this),
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
      const outputs = this.parseFieldList(
        this.parseOutputField.bind(this),
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

    let type: { name: TypeNotClass; isArray: boolean } | undefined;
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
        const typeName = this.parseTypeNotClass();
        const isArray = this.match('[]');
        type = { name: typeName, isArray };

        // Validate specific type constraints for input fields
        if ((typeName === 'image' || typeName === 'audio') && isArray) {
          throw new SignatureValidationError(
            `Input field "${name}": Arrays of ${typeName} are not supported`,
            this.position,
            this.getErrorContext(),
            `Use a single ${typeName} type instead: "${typeName}"`
          );
        }
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
    const desc = this.parseParsedString();

    return {
      name,
      desc: desc?.trim(),
      type,
      isOptional,
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

    let type:
      | { name: TypeNotClass; isArray: boolean; options?: string[] }
      | { name: 'class'; isArray: boolean; options: string[] }
      | undefined;
    this.skipWhitespace();
    if (this.match(':')) {
      this.skipWhitespace();
      if (this.match('class')) {
        const isArray = this.match('[]');
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
          const typeName = this.parseTypeNotClass();
          const isArray = this.match('[]');
          type = { name: typeName, isArray };

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

          if (typeName === 'audio') {
            throw new SignatureValidationError(
              `Output field "${name}": Audio type is not supported in output fields`,
              this.position,
              this.getErrorContext(),
              'Audio types can only be used in input fields'
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
    const desc = this.parseParsedString();

    return {
      name,
      desc: desc?.trim(),
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
      'datetime',
      'date',
      'code',
    ];

    const foundType = types.find((type) => this.match(type));
    if (!foundType) {
      const currentWord =
        this.input.slice(this.position).match(/^\w+/)?.[0] || '';
      const suggestion = this.suggestType(currentWord);

      const baseMessage = `Invalid type "${currentWord || 'empty'}"`;
      const suggestionPart = suggestion
        ? `. Did you mean "${suggestion}"?`
        : '';
      const fullMessage = `${baseMessage}${suggestionPart}`;

      throw new SignatureValidationError(
        fullMessage,
        this.position,
        this.getErrorContext(),
        `Expected one of: ${types.join(', ')}`
      );
    }
    return foundType;
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
