import type { ParsedSignature, ParsedField, ParseError, ParseWarning, FieldType } from '../types/editor';

// Reserved/generic names that should be avoided
const RESERVED_NAMES = [
  'text', 'object', 'image', 'string', 'number', 'boolean', 'json',
  'array', 'datetime', 'date', 'time', 'type', 'class', 'input', 
  'output', 'data', 'value', 'result', 'response', 'request', 'item', 'element'
];

// Valid field types
const FIELD_TYPES: FieldType[] = [
  'string', 'number', 'boolean', 'date', 'datetime', 
  'image', 'audio', 'json', 'code', 'class'
];

// Input-only types (class is output-only)
const INPUT_ONLY_TYPES = ['image', 'audio'];
const OUTPUT_ONLY_TYPES = ['class'];

export class SignatureParser {
  private input: string;
  private position: number = 0;
  private errors: ParseError[] = [];
  private warnings: ParseWarning[] = [];

  constructor(input: string) {
    this.input = input.trim();
  }

  parse(): ParsedSignature {
    this.position = 0;
    this.errors = [];
    this.warnings = [];

    try {
      // Parse optional description
      const description = this.parseDescription();
      
      // Parse input fields
      const inputFields = this.parseFields('input');
      
      // Expect arrow separator
      this.expectArrow();
      
      // Parse output fields
      const outputFields = this.parseFields('output');
      
      // Validate field names for duplicates and reserved words
      this.validateFieldNames([...inputFields, ...outputFields]);
      
      return {
        description,
        inputFields,
        outputFields,
        raw: this.input,
        valid: this.errors.length === 0,
        errors: this.errors,
        warnings: this.warnings
      };
    } catch (error) {
      // Handle parsing errors
      this.addError(
        error instanceof Error ? error.message : 'Unknown parsing error',
        this.position,
        this.position + 1
      );
      
      return {
        inputFields: [],
        outputFields: [],
        raw: this.input,
        valid: false,
        errors: this.errors,
        warnings: this.warnings
      };
    }
  }

  private parseDescription(): string | undefined {
    this.skipWhitespace();
    
    // Check for quoted description
    if (this.peek() === '"') {
      const start = this.position;
      this.advance(); // Skip opening quote
      
      let description = '';
      while (this.position < this.input.length && this.peek() !== '"') {
        description += this.advance();
      }
      
      if (this.peek() === '"') {
        this.advance(); // Skip closing quote
        this.skipWhitespace();
        return description;
      } else {
        this.addError('Unterminated description string', start, this.position);
        return undefined;
      }
    }
    
    return undefined;
  }

  private parseFields(context: 'input' | 'output'): ParsedField[] {
    const fields: ParsedField[] = [];
    this.skipWhitespace();
    
    if (this.position >= this.input.length) {
      this.addError(`Expected ${context} fields`, this.position, this.position);
      return fields;
    }
    
    while (this.position < this.input.length) {
      const field = this.parseField(context);
      if (field) {
        fields.push(field);
      }
      
      this.skipWhitespace();
      
      // Check for comma separator or arrow (for input fields)
      if (this.peek() === ',') {
        this.advance();
        this.skipWhitespace();
        continue;
      } else if (context === 'input' && this.peekString('->')) {
        break; // Found arrow, move to output parsing
      } else if (context === 'output' && this.position < this.input.length) {
        // For output fields, continue parsing or end
        if (this.peek() !== ',' && !this.isAtEnd()) {
          break;
        }
      } else {
        break;
      }
    }
    
    return fields;
  }

  private parseField(context: 'input' | 'output'): ParsedField | null {
    const start = this.position;
    this.skipWhitespace();
    
    // Parse field name
    const name = this.parseIdentifier();
    if (!name) {
      this.addError('Expected field name', this.position, this.position + 1);
      return null;
    }
    
    this.validateFieldName(name, context, start);
    
    // Parse optional marker (?)
    let isOptional = false;
    if (this.peek() === '?') {
      this.advance();
      isOptional = true;
    }
    
    // Parse internal marker (!) - only for output fields
    let isInternal = false;
    if (this.peek() === '!') {
      if (context === 'input') {
        this.addError(
          'Internal marker (!) is only allowed on output fields',
          this.position,
          this.position + 1,
          'Remove the "!" marker from input fields'
        );
      } else {
        this.advance();
        isInternal = true;
      }
    }
    
    // Parse type annotation
    let type: FieldType = 'string';
    let isArray = false;
    let classOptions: string[] | undefined;
    let codeLanguage: string | undefined;
    
    if (this.peek() === ':') {
      this.advance();
      this.skipWhitespace();
      
      const typeResult = this.parseType(context);
      if (typeResult) {
        type = typeResult.type;
        isArray = typeResult.isArray;
        classOptions = typeResult.classOptions;
        codeLanguage = typeResult.codeLanguage;
      }
    }
    
    // Parse description
    let description: string | undefined;
    this.skipWhitespace();
    if (this.peek() === '"') {
      description = this.parseQuotedString();
    }
    
    const end = this.position;
    
    return {
      name,
      type,
      description,
      isOptional,
      isInternal,
      isArray,
      classOptions,
      codeLanguage,
      position: { start, end }
    };
  }

  private parseType(context: 'input' | 'output'): {
    type: FieldType;
    isArray: boolean;
    classOptions?: string[];
    codeLanguage?: string;
  } | null {
    const start = this.position;
    const typeName = this.parseIdentifier();
    
    if (!typeName) {
      this.addError('Expected type name', start, this.position);
      return null;
    }
    
    // Handle empty or invalid type names
    if (!typeName || typeName.trim() === '' || typeName === 'empty') {
      this.addError(
        'Missing or invalid type name',
        start,
        this.position,
        `Valid types: ${FIELD_TYPES.join(', ')}`
      );
      return null;
    }

    // Validate type name
    if (!FIELD_TYPES.includes(typeName as FieldType)) {
      this.addError(
        `Invalid type "${typeName}"`,
        start,
        this.position,
        `Valid types: ${FIELD_TYPES.join(', ')}`
      );
      return null;
    }
    
    const type = typeName as FieldType;
    
    // Validate type context
    if (context === 'input' && OUTPUT_ONLY_TYPES.includes(type)) {
      this.addError(
        `Type "${type}" is only allowed on output fields`,
        start,
        this.position,
        'Use "string" type for input classifications'
      );
    }
    
    if (context === 'output' && INPUT_ONLY_TYPES.includes(type)) {
      this.addWarning(
        `Type "${type}" is typically used for input fields`,
        start,
        this.position
      );
    }
    
    // Check for array notation
    let isArray = false;
    if (this.peekString('[]')) {
      this.advance();
      this.advance();
      isArray = true;
      
      // Validate array types
      if (type === 'image' || type === 'audio') {
        this.addError(
          `Arrays of ${type} are not supported`,
          start,
          this.position,
          `Use individual ${type} fields instead`
        );
      }
    }
    
    // Parse type-specific options
    let classOptions: string[] | undefined;
    let codeLanguage: string | undefined;
    
    if (type === 'class') {
      classOptions = this.parseClassOptions();
    } else if (type === 'code') {
      codeLanguage = this.parseCodeLanguage();
    }
    
    return {
      type,
      isArray,
      classOptions,
      codeLanguage
    };
  }

  private parseClassOptions(): string[] | undefined {
    this.skipWhitespace();
    // New syntax: class "option1,option2,option3" "description"
    if (this.peek() === '"') {
      const optionsString = this.parseQuotedString();
      if (optionsString) {
        // Split comma-separated options
        const options = optionsString.split(',').map(opt => opt.trim()).filter(opt => opt.length > 0);
        return options.length > 0 ? options : undefined;
      }
    }
    // Legacy syntax support: class("option1", "option2")
    else if (this.peek() === '(') {
      this.advance();
      const options: string[] = [];
      
      while (this.position < this.input.length && this.peek() !== ')') {
        this.skipWhitespace();
        const option = this.parseQuotedString() || this.parseIdentifier();
        if (option) {
          options.push(option);
        }
        
        this.skipWhitespace();
        if (this.peek() === ',') {
          this.advance();
        }
      }
      
      if (this.peek() === ')') {
        this.advance();
        return options;
      } else {
        this.addError('Expected closing parenthesis for class options', this.position, this.position + 1);
      }
    }
    return undefined;
  }

  private parseCodeLanguage(): string | undefined {
    // For code type, no language specification needed - just code "description"
    // Legacy syntax support: code("language")  
    this.skipWhitespace();
    if (this.peek() === '(') {
      this.advance();
      this.skipWhitespace();
      const language = this.parseQuotedString() || this.parseIdentifier();
      this.skipWhitespace();
      if (this.peek() === ')') {
        this.advance();
        return language;
      } else {
        this.addError('Expected closing parenthesis for code language', this.position, this.position + 1);
      }
    }
    return undefined; // No language needed for new syntax
  }

  private parseIdentifier(): string | null {
    this.skipWhitespace();
    let identifier = '';
    
    // First character must be letter or underscore
    if (this.isLetter(this.peek()) || this.peek() === '_') {
      identifier += this.advance();
      
      // Subsequent characters can be letters, digits, or underscores
      while (this.position < this.input.length && 
             (this.isAlphaNumeric(this.peek()) || this.peek() === '_')) {
        identifier += this.advance();
      }
      
      return identifier;
    }
    
    return null;
  }

  private parseQuotedString(): string | null {
    if (this.peek() === '"') {
      this.advance(); // Skip opening quote
      let content = '';
      
      while (this.position < this.input.length && this.peek() !== '"') {
        content += this.advance();
      }
      
      if (this.peek() === '"') {
        this.advance(); // Skip closing quote
        return content;
      } else {
        this.addError('Unterminated string', this.position, this.position);
      }
    }
    return null;
  }

  private expectArrow(): void {
    this.skipWhitespace();
    if (this.peekString('->')) {
      this.advance();
      this.advance();
    } else {
      this.addError('Expected "->" arrow separator', this.position, this.position + 1);
    }
  }

  private validateFieldName(name: string, context: 'input' | 'output', position: number): void {
    // Check for reserved names
    if (RESERVED_NAMES.includes(name.toLowerCase())) {
      const suggestions = context === 'input'
        ? ['userInput', 'questionText', 'documentContent', 'messageText', 'queryString']
        : ['responseText', 'analysisResult', 'categoryType', 'summaryText', 'outputData'];
      
      this.addWarning(
        `Field name '${name}' is too generic`,
        position,
        position + name.length,
        `Use a more descriptive name. Examples: ${suggestions.slice(0, 3).join(', ')}`
      );
    }
    
    // Check naming conventions
    if (name.length < 2) {
      this.addError(
        'Field name too short',
        position,
        position + name.length,
        'Field names should be at least 2 characters'
      );
    }
    
    if (name.length > 50) {
      this.addError(
        'Field name too long',
        position,
        position + name.length,
        'Field names should be at most 50 characters'
      );
    }
    
    // Check for camelCase or snake_case
    const isCamelCase = /^[a-z][a-zA-Z0-9]*$/.test(name);
    const isSnakeCase = /^[a-z][a-z0-9_]*$/.test(name);
    
    if (!isCamelCase && !isSnakeCase) {
      this.addWarning(
        `Field name '${name}' should use camelCase or snake_case`,
        position,
        position + name.length,
        'Examples: userQuestion, user_question'
      );
    }
  }

  private validateFieldNames(fields: ParsedField[]): void {
    const names = new Set<string>();
    
    for (const field of fields) {
      if (names.has(field.name)) {
        this.addError(
          `Duplicate field name '${field.name}'`,
          field.position.start,
          field.position.end,
          'Each field must have a unique name'
        );
      }
      names.add(field.name);
    }
  }

  // Utility methods
  private peek(): string {
    return this.position < this.input.length ? this.input[this.position] : '';
  }

  private peekString(str: string): boolean {
    return this.input.substring(this.position, this.position + str.length) === str;
  }

  private advance(): string {
    return this.position < this.input.length ? this.input[this.position++] : '';
  }

  private skipWhitespace(): void {
    while (this.position < this.input.length && /\s/.test(this.input[this.position])) {
      this.position++;
    }
  }

  private isAtEnd(): boolean {
    return this.position >= this.input.length;
  }

  private isLetter(char: string): boolean {
    return /[a-zA-Z]/.test(char);
  }

  private isAlphaNumeric(char: string): boolean {
    return /[a-zA-Z0-9]/.test(char);
  }

  private addError(message: string, start: number, end: number, suggestion?: string): void {
    this.errors.push({
      message,
      suggestion,
      position: { start, end },
      severity: 'error'
    });
  }

  private addWarning(message: string, start: number, end: number, suggestion?: string): void {
    this.warnings.push({
      message,
      suggestion,
      position: { start, end }
    });
  }
}

export function parseSignature(input: string): ParsedSignature {
  const parser = new SignatureParser(input);
  return parser.parse();
}