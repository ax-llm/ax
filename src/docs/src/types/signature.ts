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
  | 'class'
  | 'array';

export type ModifierType = 'optional' | 'internal';

export interface FieldConfig {
  id: string;
  name: string;
  type: FieldType;
  description: string;
  modifiers: ModifierType[];
  // Type-specific configs
  arrayElementType?: FieldType;
  classOptions?: string[];
  codeLanguage?: string;
}

export interface SignatureField {
  id: string;
  name: string;
  type: FieldType;
  description: string;
  modifiers: ModifierType[];
  isInput: boolean;
  // Type-specific properties
  arrayElementType?: FieldType;
  classOptions?: string[];
  codeLanguage?: string;
}

export interface SignatureDefinition {
  id: string;
  name: string;
  description?: string;
  inputFields: SignatureField[];
  outputFields: SignatureField[];
  createdAt: Date;
  updatedAt: Date;
}

export interface SignatureTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  signature: SignatureDefinition;
  tags: string[];
}

export interface ExecutionResult {
  id: string;
  signatureId: string;
  inputs: Record<string, any>;
  outputs: Record<string, any>;
  executedAt: Date;
  duration: number;
  success: boolean;
  error?: string;
}