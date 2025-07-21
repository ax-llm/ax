export interface ParsedSignature {
  description?: string;
  inputFields: ParsedField[];
  outputFields: ParsedField[];
  raw: string;
  valid: boolean;
  errors: ParseError[];
  warnings: ParseWarning[];
}

export interface ParsedField {
  name: string;
  type: FieldType;
  description?: string;
  isOptional?: boolean;
  isInternal?: boolean;
  isArray?: boolean;
  classOptions?: string[];
  codeLanguage?: string;
  position: {
    start: number;
    end: number;
  };
}

export interface ParseError {
  message: string;
  suggestion?: string;
  position: {
    start: number;
    end: number;
  };
  severity: 'error' | 'warning';
}

export interface ParseWarning {
  message: string;
  suggestion?: string;
  position: {
    start: number;
    end: number;
  };
}

export interface SyntaxHighlight {
  type: 'keyword' | 'fieldName' | 'fieldType' | 'description' | 'arrow' | 'separator' | 'modifier' | 'error';
  start: number;
  end: number;
  text: string;
}

export interface AutocompleteItem {
  label: string;
  detail?: string;
  documentation?: string;
  insertText: string;
  kind: 'keyword' | 'type' | 'modifier' | 'template';
}

export interface EditorPosition {
  line: number;
  column: number;
  offset: number;
}

export type FieldType = 
  | 'string' 
  | 'number' 
  | 'boolean' 
  | 'date' 
  | 'datetime' 
  | 'image' 
  | 'audio' 
  | 'json' 
  | 'code' 
  | 'class';

export interface EditorState {
  content: string;
  cursorPosition: number;
  selection: {
    start: number;
    end: number;
  };
  parsedSignature: ParsedSignature;
  syntaxHighlights: SyntaxHighlight[];
  autocompleteVisible: boolean;
  autocompleteItems: AutocompleteItem[];
  autocompletePosition: EditorPosition;
  typeDropdownVisible: boolean;
  typeDropdownPosition: { x: number; y: number };
  selectedOptional: boolean;
}