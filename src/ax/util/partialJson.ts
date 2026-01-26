/**
 * Marker indicating where JSON was truncated during partial parsing.
 * Used to detect incomplete structures in streaming scenarios.
 */
export interface JsonRepairMarker {
  /** Nesting level at the point of truncation (0 = complete, >0 = inside open structures) */
  nestingLevel: number;
  /** Whether we're currently inside an open string */
  inString: boolean;
  /** Whether we're currently inside an open array */
  inArray: boolean;
  /** Whether we're currently inside an open object */
  inObject: boolean;
}

/**
 * Result of parsing partial JSON, including the parsed value and repair marker.
 */
export interface ParsedPartialJson {
  /** The parsed value, or null if parsing failed */
  parsed: unknown;
  /** Marker indicating where truncation occurred, or null if JSON was complete */
  partialMarker: JsonRepairMarker | null;
}

/**
 * Analyzes JSON context to determine nesting level and state at the end of parsing.
 * This helps detect incomplete structures in streaming scenarios.
 */
function analyzeJsonContext(json: string): JsonRepairMarker {
  let nestingLevel = 0;
  let inString = false;
  let isEscaped = false;
  let inArray = false;
  let inObject = false;
  const stack: Array<'{' | '['> = [];

  for (let i = 0; i < json.length; i++) {
    const char = json[i];

    if (isEscaped) {
      isEscaped = false;
      continue;
    }

    if (char === '\\') {
      isEscaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') {
        stack.push('{');
        nestingLevel++;
      } else if (char === '[') {
        stack.push('[');
        nestingLevel++;
      } else if (char === '}') {
        if (stack.length > 0 && stack[stack.length - 1] === '{') {
          stack.pop();
          nestingLevel--;
        }
      } else if (char === ']') {
        if (stack.length > 0 && stack[stack.length - 1] === '[') {
          stack.pop();
          nestingLevel--;
        }
      }
    }
  }

  // Determine if we're inside an array or object at the end
  if (stack.length > 0) {
    const lastBracket = stack[stack.length - 1];
    inArray = lastBracket === '[';
    inObject = lastBracket === '{';
  }

  return { nestingLevel, inString, inArray, inObject };
}

export function parsePartialJson(json: string): ParsedPartialJson {
  if (!json.trim()) return { parsed: null, partialMarker: null };

  // Fast path: try standard parse first
  try {
    return { parsed: JSON.parse(json), partialMarker: null };
  } catch {
    // ignore and try repair
  }

  // Analyze the context before repair to get accurate marker
  const marker = analyzeJsonContext(json);

  // If standard parse fails, try to "repair" the JSON string
  // This is a best-effort heuristic approach for streaming JSON
  const repaired = repairJson(json);

  try {
    return { parsed: JSON.parse(repaired), partialMarker: marker };
  } catch {
    // If repair fails, return null (wait for more chunks)
    return { parsed: null, partialMarker: marker };
  }
}

function repairJson(json: string): string {
  let result = json.trim();

  // Remove trailing comma at the end of the string
  if (result.endsWith(',')) {
    result = result.slice(0, -1);
  }

  // Handle trailing colon (incomplete property value)
  // e.g. {"name": "John", "age": -> {"name": "John"}
  // We need to remove the key and colon
  if (result.match(/,\s*"[^"]*"\s*:\s*$/)) {
    result = result.replace(/,\s*"[^"]*"\s*:\s*$/, '');
  } else if (result.match(/\{\s*"[^"]*"\s*:\s*$/)) {
    // Handle case where it's the first/only property: {"age": -> {}
    result = result.replace(/"[^"]*"\s*:\s*$/, '');
  }

  // Fix truncated numbers
  // If it ends with e, E, ., +, - we strip them
  // e.g. 12. -> 12, 12e -> 12, 12e+ -> 12
  // We loop because we might have 12.e (invalid but possible in stream?) or 12e+
  // Also handle patterns like 12e+ or 12e- where exponent sign is present but no digits
  while (result.match(/[0-9][eE.+-]$/) || result.match(/[eE][+-]$/)) {
    result = result.slice(0, -1);
  }
  // If it ends with just a sign or empty exponent part that leaves no number, we might need to be careful
  // e.g. "{"a": -" -> "{"a": " (invalid value)
  // But let's handle the "invalid value" case generally.

  // Remove trailing comma before closing brackets (standard JSON fix)
  result = result.replace(/,(\s*[}\]])/g, '$1');

  // Fix truncated primitives (true, false, null)
  // If the string ends with a partial primitive, remove it or complete it
  // It's safer to remove the partial key-value pair if it's in an object,
  // or the partial value if it's in an array, but for simplicity we'll try to complete it
  // if it looks like a primitive.

  // Check for truncated "true"
  if (
    result.match(/t(r(u(e)?)?)?$/) &&
    !result.endsWith('"') &&
    !result.endsWith('true')
  ) {
    // Only if preceded by : or [ or ,
    if (result.match(/[:[,]\s*t(r(u(e)?)?)?$/)) {
      result = result.replace(/t(r(u(e)?)?)?$/, 'true');
    }
  }

  // Check for truncated "false"
  if (
    result.match(/f(a(l(s(e)?)?)?)?$/) &&
    !result.endsWith('"') &&
    !result.endsWith('false')
  ) {
    if (result.match(/[:[,]\s*f(a(l(s(e)?)?)?)?$/)) {
      result = result.replace(/f(a(l(s(e)?)?)?)?$/, 'false');
    }
  }

  // Check for truncated "null"
  if (
    result.match(/n(u(l(l)?)?)?$/) &&
    !result.endsWith('"') &&
    !result.endsWith('null')
  ) {
    if (result.match(/[:[,]\s*n(u(l(l)?)?)?$/)) {
      result = result.replace(/n(u(l(l)?)?)?$/, 'null');
    }
  }

  // Handle unclosed keys / partial entries
  // If we have a comma followed by something that is NOT a complete key-value pair, remove it.
  // A complete key-value pair in an object needs a colon.
  // We are looking for: , "partialKey
  // OR: , partialKey (if quotes missing)
  // BUT we must be careful not to remove elements in an array: [1, 2

  // We can't easily distinguish array vs object context with regex alone.
  // Let's use the stack-based pass to help, or apply a heuristic that if we are in an object (last brace was {),
  // and we have a comma, and then no colon, we strip back to comma.

  // Let's do the stack pass FIRST to determine context?
  // No, we need to fix the string before closing braces.

  // Heuristic: If the last significant char is NOT } or ] or " or digit or true/false/null,
  // it might be a partial key or value.

  // Let's try the specific "unclosed key" case:
  // Ends with: , "someText
  // And "someText doesn't contain :
  // And we assume we are in an object if we see "key": "value" patterns previously?
  // It's risky.

  // Safer approach for unclosed keys:
  // If we have `... , "text` (and text has no quote), we close the quote `... , "text"`.
  // Then we have `... , "text"`.
  // If this is an object, it's invalid (missing colon).
  // If this is an array, it's valid.

  // Let's rely on the stack loop to close strings.
  // AFTER closing strings, if we have `... , "text"}` (object context), we know it's invalid.
  // We can try to fix it then?

  // Let's modify the stack loop to also track if we are expecting a value (saw colon).

  const stack: string[] = [];
  let inString = false;
  let isEscaped = false;

  // We'll rebuild the string if needed, or just analyze.
  // Actually, let's just use the loop to close strings and brackets first.

  for (let i = 0; i < result.length; i++) {
    const char = result[i];

    if (isEscaped) {
      isEscaped = false;
      continue;
    }

    if (char === '\\') {
      isEscaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') stack.push('}');
      else if (char === '[') stack.push(']');
      else if (char === '}') {
        if (stack.length > 0 && stack[stack.length - 1] === '}') {
          stack.pop();
        }
      } else if (char === ']') {
        if (stack.length > 0 && stack[stack.length - 1] === ']') {
          stack.pop();
        }
      }
    }
  }

  // If we ended with an escape character (trailing backslash), remove it
  if (isEscaped) {
    result = result.slice(0, -1);
  }

  // Close any open strings
  if (inString) {
    result += '"';
  }

  // console.log('DEBUG repairJson before key fix:', result);

  // Now, before closing structures, let's check for the "unclosed key" problem.
  // If we are in an object (top of stack is '}'), and the last thing we added was a string (or we just closed one),
  // and there is no colon before it...

  // This is getting complicated to parse on the already-partial string.
  // Alternative: Regex for the specific case of `... , "key"` at the end.

  // If result ends with `,\s*"[^"]*"\s*$` (comma, optional space, string, optional space)
  // AND the stack expects '}' (object)
  // Then it's likely a key without value.

  if (stack.length > 0 && stack[stack.length - 1] === '}') {
    // We are in an object
    // Check if we have a trailing key without value
    // e.g. `... , "key"`
    if (result.match(/,\s*"[^"]*"\s*$/)) {
      // Remove the trailing key
      result = result.replace(/,\s*"[^"]*"\s*$/, '');
    }
  }

  // Close any open structures
  while (stack.length > 0) {
    result += stack.pop();
  }

  // console.log('DEBUG repairJson result:', result);
  return result;
}
