import type { SyntaxHighlight, ParsedSignature } from '../types/editor';

const KEYWORDS = ['class', 'string', 'number', 'boolean', 'date', 'datetime', 'image', 'audio', 'json', 'code'];
const MODIFIERS = ['?', '!', '[]'];

export function generateSyntaxHighlights(content: string, parsedSignature: ParsedSignature): SyntaxHighlight[] {
  const highlights: SyntaxHighlight[] = [];
  
  // Highlight description
  if (parsedSignature.description) {
    const descMatch = content.match(/"([^"]*)"/);
    if (descMatch) {
      highlights.push({
        type: 'description',
        start: descMatch.index!,
        end: descMatch.index! + descMatch[0].length,
        text: descMatch[0]
      });
    }
  }
  
  // Highlight arrow separator
  const arrowMatch = content.match(/->/);
  if (arrowMatch) {
    highlights.push({
      type: 'arrow',
      start: arrowMatch.index!,
      end: arrowMatch.index! + 2,
      text: '->'
    });
  }
  
  // Highlight field names and types from parsed signature
  const allFields = [...parsedSignature.inputFields, ...parsedSignature.outputFields];
  
  for (const field of allFields) {
    // Highlight field name
    highlights.push({
      type: 'fieldName',
      start: field.position.start,
      end: field.position.start + field.name.length,
      text: field.name
    });
    
    // Find and highlight field type
    const fieldText = content.substring(field.position.start, field.position.end);
    const typeMatch = fieldText.match(new RegExp(`:(\\s*)(${KEYWORDS.join('|')})`));
    if (typeMatch) {
      const typeStart = field.position.start + typeMatch.index! + typeMatch[1].length + 1;
      highlights.push({
        type: 'fieldType',
        start: typeStart,
        end: typeStart + typeMatch[2].length,
        text: typeMatch[2]
      });
    }
    
    // Highlight modifiers
    for (const modifier of MODIFIERS) {
      const modifierIndex = fieldText.indexOf(modifier);
      if (modifierIndex !== -1) {
        highlights.push({
          type: 'modifier',
          start: field.position.start + modifierIndex,
          end: field.position.start + modifierIndex + modifier.length,
          text: modifier
        });
      }
    }
    
    // Highlight field description
    const descMatch = fieldText.match(/"([^"]*)"/);
    if (descMatch && descMatch.index) {
      highlights.push({
        type: 'description',
        start: field.position.start + descMatch.index,
        end: field.position.start + descMatch.index + descMatch[0].length,
        text: descMatch[0]
      });
    }
  }
  
  // Highlight separators (commas)
  const commaRegex = /,/g;
  let commaMatch;
  while ((commaMatch = commaRegex.exec(content)) !== null) {
    highlights.push({
      type: 'separator',
      start: commaMatch.index,
      end: commaMatch.index + 1,
      text: ','
    });
  }
  
  // Highlight errors
  for (const error of parsedSignature.errors) {
    highlights.push({
      type: 'error',
      start: error.position.start,
      end: error.position.end,
      text: content.substring(error.position.start, error.position.end)
    });
  }
  
  // Sort highlights by start position
  highlights.sort((a, b) => a.start - b.start);
  
  return highlights;
}

export function getSyntaxHighlightStyles(): Record<string, string> {
  return {
    keyword: 'color: #d73a49; font-weight: 600;',
    fieldName: 'color: #6f42c1; font-weight: 500;',
    fieldType: 'color: #005cc5; font-weight: 600;',
    description: 'color: #032f62; font-style: italic;',
    arrow: 'color: #e36209; font-weight: 700;',
    separator: 'color: #586069;',
    modifier: 'color: #d73a49; font-weight: 600;',
    error: 'background-color: #ffeef0; color: #cb2431; text-decoration: underline wavy #cb2431;'
  };
}

export function getSyntaxHighlightStylesDark(): Record<string, string> {
  return {
    keyword: 'color: #f97583; font-weight: 600;',
    fieldName: 'color: #b392f0; font-weight: 500;',
    fieldType: 'color: #79b8ff; font-weight: 600;',
    description: 'color: #9ecbff; font-style: italic;',
    arrow: 'color: #ffab70; font-weight: 700;',
    separator: 'color: #959da5;',
    modifier: 'color: #f97583; font-weight: 600;',
    error: 'background-color: #86181d; color: #fdaeb7; text-decoration: underline wavy #fdaeb7;'
  };
}