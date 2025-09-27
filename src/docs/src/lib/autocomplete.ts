import type { AutocompleteItem, EditorPosition } from '../types/editor';

/**
 * Gets autocomplete items based on the current content and cursor position.
 * Analyzes the context around the cursor to determine what type of completions to offer.
 * 
 * @param content - The full content of the editor
 * @param cursorPosition - The current position of the cursor in the content
 * @returns Array of autocomplete items relevant to the current context
 */
export function getAutocompleteItems(
  content: string,
  cursorPosition: number
): AutocompleteItem[] {
  const beforeCursor = content.substring(0, cursorPosition);
  const context = analyzeContext(beforeCursor);

  switch (context.type) {
    case 'fieldType':
      return getFieldTypeCompletions();
    case 'typeAfterColon':
      return getFieldTypeCompletions();
    case 'modifier':
      return getModifierCompletions();
    case 'arrow':
      return getArrowCompletions();
    case 'template':
      return getTemplateCompletions();
    case 'classOptions':
      return getClassOptionCompletions();
    case 'codeLanguage':
      return getCodeLanguageCompletions();
    default:
      return getGeneralCompletions();
  }
}

/**
 * Analyzes the text before the cursor to determine the current editing context.
 * This helps determine what type of autocomplete suggestions should be shown.
 * 
 * @param beforeCursor - The text content before the current cursor position
 * @returns Object containing the context type and optional partial text being typed
 */
function analyzeContext(beforeCursor: string): {
  type: string;
  partial?: string;
} {
  // Check if we're immediately after a colon (type context)
  if (beforeCursor.endsWith(':')) {
    return { type: 'typeAfterColon' };
  }

  // Check if we're after a colon with some text (type context)
  const lastColonIndex = beforeCursor.lastIndexOf(':');
  const lastSpaceAfterColon = beforeCursor
    .substring(lastColonIndex)
    .indexOf(' ');

  if (
    lastColonIndex !== -1 &&
    (lastSpaceAfterColon === -1 || lastSpaceAfterColon > lastColonIndex)
  ) {
    const afterColon = beforeCursor.substring(lastColonIndex + 1).trim();
    return { type: 'fieldType', partial: afterColon };
  }

  // Check if we're at the beginning or after a comma (field name context)
  const trimmed = beforeCursor.trim();
  if (trimmed === '' || trimmed.endsWith(',') || trimmed.endsWith('->')) {
    return { type: 'fieldName' };
  }

  // Check if we're typing an arrow
  if (beforeCursor.endsWith('-') || beforeCursor.endsWith(' -')) {
    return { type: 'arrow' };
  }

  // Check if we're in a class definition
  if (
    beforeCursor.includes('class(') &&
    !beforeCursor.substring(beforeCursor.lastIndexOf('class(')).includes(')')
  ) {
    return { type: 'classOptions' };
  }

  // Check if we're in a code definition
  if (
    beforeCursor.includes('code(') &&
    !beforeCursor.substring(beforeCursor.lastIndexOf('code(')).includes(')')
  ) {
    return { type: 'codeLanguage' };
  }

  // Check for template context (empty editor or just whitespace)
  if (trimmed === '' || trimmed === '"') {
    return { type: 'template' };
  }

  return { type: 'general' };
}

/**
 * Returns autocomplete items for field type completions.
 * Includes all available field types like string, number, boolean, etc.
 * 
 * @returns Array of autocomplete items for field types
 */
function getFieldTypeCompletions(): AutocompleteItem[] {
  return [
    {
      label: 'string',
      detail: 'Text field',
      documentation: 'A text field for string input/output',
      insertText: 'string',
      kind: 'type',
    },
    {
      label: 'number',
      detail: 'Numeric field',
      documentation: 'A numeric field for integer or decimal values',
      insertText: 'number',
      kind: 'type',
    },
    {
      label: 'boolean',
      detail: 'True/false field',
      documentation: 'A boolean field for true/false values',
      insertText: 'boolean',
      kind: 'type',
    },
    {
      label: 'date',
      detail: 'Date field',
      documentation: 'A date field (YYYY-MM-DD format)',
      insertText: 'date',
      kind: 'type',
    },
    {
      label: 'datetime',
      detail: 'Date and time field',
      documentation: 'A datetime field with date and time information',
      insertText: 'datetime',
      kind: 'type',
    },
    {
      label: 'image',
      detail: 'Image field (input only)',
      documentation: 'An image field for file uploads (input fields only)',
      insertText: 'image',
      kind: 'type',
    },
    {
      label: 'audio',
      detail: 'Audio field (input only)',
      documentation:
        'An audio field for audio file uploads (input fields only)',
      insertText: 'audio',
      kind: 'type',
    },
    {
      label: 'json',
      detail: 'JSON object field',
      documentation: 'A JSON field for structured data objects',
      insertText: 'json',
      kind: 'type',
    },
    {
      label: 'code',
      detail: 'Code block field',
      documentation: 'A code field with syntax highlighting',
      insertText: 'code("python")',
      kind: 'type',
    },
    {
      label: 'class',
      detail: 'Classification field (output only)',
      documentation:
        'A classification field with predefined options (output fields only)',
      insertText: 'class("option1", "option2", "option3")',
      kind: 'type',
    },
  ];
}

/**
 * Returns autocomplete items for field modifiers.
 * Includes optional (?), internal (!), and array ([]) modifiers.
 * 
 * @returns Array of autocomplete items for field modifiers
 */
function getModifierCompletions(): AutocompleteItem[] {
  return [
    {
      label: '?',
      detail: 'Optional modifier',
      documentation: 'Makes the field optional',
      insertText: '?',
      kind: 'modifier',
    },
    {
      label: '!',
      detail: 'Internal modifier (output only)',
      documentation: 'Marks the field as internal (output fields only)',
      insertText: '!',
      kind: 'modifier',
    },
    {
      label: '[]',
      detail: 'Array modifier',
      documentation: 'Makes the field an array of the specified type',
      insertText: '[]',
      kind: 'modifier',
    },
  ];
}

/**
 * Returns autocomplete items for arrow separators.
 * Provides the arrow (->) that separates input fields from output fields.
 * 
 * @returns Array containing the arrow separator autocomplete item
 */
function getArrowCompletions(): AutocompleteItem[] {
  return [
    {
      label: '->',
      detail: 'Arrow separator',
      documentation: 'Separates input fields from output fields',
      insertText: '->',
      kind: 'keyword',
    },
  ];
}

/**
 * Returns autocomplete items for common template patterns.
 * Provides pre-built templates for common use cases like sentiment analysis, code generation, etc.
 * 
 * @returns Array of autocomplete items for template patterns
 */
function getTemplateCompletions(): AutocompleteItem[] {
  return [
    {
      label: 'Sentiment Analysis',
      detail: 'Text sentiment classification',
      documentation: 'Analyze text sentiment with confidence score',
      insertText:
        'inputText:string "Text to analyze" -> sentimentCategory:class("positive", "negative", "neutral"), confidenceScore:number "Confidence 0-1"',
      kind: 'template',
    },
    {
      label: 'Code Generation',
      detail: 'Programming problem solver',
      documentation: 'Generate code solutions with explanations',
      insertText:
        'problemDescription:string "Programming problem to solve" -> pythonSolution:code("python") "Python code solution", solutionExplanation:string "Explanation of approach"',
      kind: 'template',
    },
    {
      label: 'Data Extraction',
      detail: 'Structured data from text',
      documentation: 'Extract structured information from unstructured text',
      insertText:
        'customerFeedback:string "Customer feedback text" -> extractedTopics:string[] "Topics mentioned", urgencyLevel:class("low", "medium", "high"), actionItems?:string[] "Required actions"',
      kind: 'template',
    },
    {
      label: 'Text Summarization',
      detail: 'Document summarization',
      documentation: 'Summarize long documents into key points',
      insertText:
        'documentText:string "Document to summarize" -> documentSummary:string "Concise summary", keyPoints:string[] "Main points", wordCount:number "Summary word count"',
      kind: 'template',
    },
    {
      label: 'Question Answering',
      detail: 'Answer questions from context',
      documentation: 'Answer questions based on provided context',
      insertText:
        'contextText:string "Context information", userQuestion:string "Question to answer" -> answer:string "Answer based on context", confidence:number "Answer confidence 0-1"',
      kind: 'template',
    },
    {
      label: 'Language Translation',
      detail: 'Text translation',
      documentation: 'Translate text between languages',
      insertText:
        'sourceText:string "Text to translate", targetLanguage:string "Target language" -> translatedText:string "Translated text", sourceLanguage:string "Detected source language"',
      kind: 'template',
    },
  ];
}

/**
 * Returns autocomplete items for common class option patterns.
 * Provides pre-defined sets of classification options for common use cases.
 * 
 * @returns Array of autocomplete items for class option templates
 */
function getClassOptionCompletions(): AutocompleteItem[] {
  return [
    {
      label: 'Sentiment Options',
      detail: 'Common sentiment classes',
      documentation: 'Standard sentiment analysis options',
      insertText: '"positive", "negative", "neutral"',
      kind: 'template',
    },
    {
      label: 'Priority Levels',
      detail: 'Priority classification',
      documentation: 'Standard priority levels',
      insertText: '"low", "medium", "high"',
      kind: 'template',
    },
    {
      label: 'Size Categories',
      detail: 'Size classifications',
      documentation: 'Standard size categories',
      insertText: '"small", "medium", "large"',
      kind: 'template',
    },
    {
      label: 'Quality Ratings',
      detail: 'Quality assessment',
      documentation: 'Quality rating options',
      insertText: '"poor", "fair", "good", "excellent"',
      kind: 'template',
    },
  ];
}

/**
 * Returns autocomplete items for programming language options in code fields.
 * Provides common programming languages that can be used with code field types.
 * 
 * @returns Array of autocomplete items for code language options
 */
function getCodeLanguageCompletions(): AutocompleteItem[] {
  return [
    {
      label: 'python',
      detail: 'Python code',
      insertText: '"python"',
      kind: 'template',
    },
    {
      label: 'javascript',
      detail: 'JavaScript code',
      insertText: '"javascript"',
      kind: 'template',
    },
    {
      label: 'typescript',
      detail: 'TypeScript code',
      insertText: '"typescript"',
      kind: 'template',
    },
    {
      label: 'java',
      detail: 'Java code',
      insertText: '"java"',
      kind: 'template',
    },
    { label: 'cpp', detail: 'C++ code', insertText: '"cpp"', kind: 'template' },
    {
      label: 'rust',
      detail: 'Rust code',
      insertText: '"rust"',
      kind: 'template',
    },
    { label: 'go', detail: 'Go code', insertText: '"go"', kind: 'template' },
    { label: 'sql', detail: 'SQL code', insertText: '"sql"', kind: 'template' },
  ];
}

/**
 * Returns general autocomplete items that combine multiple completion types.
 * Used as a fallback when the context doesn't match specific completion types.
 * 
 * @returns Array of general autocomplete items including field types, modifiers, and arrows
 */
function getGeneralCompletions(): AutocompleteItem[] {
  return [
    ...getFieldTypeCompletions(),
    ...getModifierCompletions(),
    ...getArrowCompletions(),
  ];
}

/**
 * Calculates the position for displaying autocomplete suggestions.
 * Currently returns a simple position based on cursor position.
 * 
 * @param _element - The HTML element (currently unused)
 * @param cursorPosition - The current cursor position in the editor
 * @returns Editor position object with line, column, and offset information
 */
export function calculateAutocompletePosition(
  _element: HTMLElement,
  cursorPosition: number
): EditorPosition {
  // This would need to be implemented based on the actual editor implementation
  // For now, return a simple position
  return {
    line: 0,
    column: cursorPosition,
    offset: cursorPosition,
  };
}
