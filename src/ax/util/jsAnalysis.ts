function isIdentifierChar(ch: string | undefined): boolean {
  return !!ch && /[A-Za-z0-9_$]/.test(ch);
}

// A `/` opens a regular expression only where an expression may start. After a value (an
// identifier, `)`, `]`, a literal) it is division, and reading it as a pattern would swallow
// the code up to the next slash. Keywords that take an expression are listed because they end
// in an identifier character.
const REGEX_PRECEDING_PUNCTUATION = new Set([
  '(',
  ',',
  '=',
  ':',
  '[',
  '!',
  '&',
  '|',
  '?',
  '{',
  '}',
  ';',
  '+',
  '-',
  '*',
  '%',
  '<',
  '>',
  '~',
  '^',
]);
const REGEX_PRECEDING_KEYWORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'case',
  'do',
  'else',
  'yield',
  'await',
  'throw',
]);

/** Whether the `/` at `index` can begin a regular expression, judged from the sanitized code
 * emitted so far: strings and comments are already blanks there, so the last significant
 * character is real code. */
function startsRegex(emitted: string): boolean {
  let cursor = emitted.length - 1;
  while (cursor >= 0 && (emitted[cursor] === ' ' || emitted[cursor] === '\t')) {
    cursor--;
  }
  if (cursor < 0) {
    return true;
  }
  const previous = emitted[cursor] ?? '';
  if (REGEX_PRECEDING_PUNCTUATION.has(previous)) {
    return true;
  }
  if (!isIdentifierChar(previous)) {
    return false;
  }
  let start = cursor;
  while (start > 0 && isIdentifierChar(emitted[start - 1])) {
    start--;
  }
  return REGEX_PRECEDING_KEYWORDS.has(emitted.slice(start, cursor + 1));
}

/** Index just past the regular expression literal that starts at `start`, or -1 when the line
 * ends first — a `/` that begins division never has a closing slash on the same line. */
function findRegexEnd(code: string, start: number): number {
  let inCharacterClass = false;
  for (let i = start + 1; i < code.length; i++) {
    const ch = code[i] ?? '';
    if (ch === '\n' || ch === '\r') {
      return -1;
    }
    if (ch === '\\') {
      i++;
      continue;
    }
    if (inCharacterClass) {
      if (ch === ']') {
        inCharacterClass = false;
      }
      continue;
    }
    if (ch === '[') {
      inCharacterClass = true;
      continue;
    }
    if (ch === '/') {
      let end = i + 1;
      while (end < code.length && /[a-z]/i.test(code[end] ?? '')) {
        end++;
      }
      return end;
    }
  }
  return -1;
}

function isIdentifierStart(ch: string | undefined): boolean {
  return !!ch && /[A-Za-z_$]/.test(ch);
}

export function stripJsStringsAndComments(code: string): string {
  let out = '';
  let i = 0;
  let state:
    | 'normal'
    | 'single'
    | 'double'
    | 'template'
    | 'lineComment'
    | 'blockComment' = 'normal';
  let escaped = false;

  while (i < code.length) {
    const ch = code[i] ?? '';
    const next = code[i + 1] ?? '';

    if (state === 'lineComment') {
      if (ch === '\n') {
        out += '\n';
        state = 'normal';
      } else {
        out += ' ';
      }
      i++;
      continue;
    }

    if (state === 'blockComment') {
      if (ch === '*' && next === '/') {
        out += '  ';
        i += 2;
        state = 'normal';
      } else {
        out += ch === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }

    if (state === 'single' || state === 'double' || state === 'template') {
      const quote = state === 'single' ? "'" : state === 'double' ? '"' : '`';
      if (escaped) {
        out += ch === '\n' ? '\n' : ' ';
        escaped = false;
        i++;
        continue;
      }
      if (ch === '\\') {
        out += ' ';
        escaped = true;
        i++;
        continue;
      }
      if (ch === quote) {
        out += ' ';
        state = 'normal';
        i++;
        continue;
      }
      out += ch === '\n' ? '\n' : ' ';
      i++;
      continue;
    }

    if (ch === '/' && next === '/') {
      out += '  ';
      i += 2;
      state = 'lineComment';
      continue;
    }

    if (ch === '/' && next === '*') {
      out += '  ';
      i += 2;
      state = 'blockComment';
      continue;
    }

    // A regular expression literal is not code: `/['"]/` used to open a string at its quote and
    // blank every line after it, hiding the calls the callers of this function look for.
    if (ch === '/' && startsRegex(out)) {
      const end = findRegexEnd(code, i);
      if (end !== -1) {
        out += ' '.repeat(end - i);
        i = end;
        continue;
      }
    }

    if (ch === "'") {
      out += ' ';
      i++;
      state = 'single';
      continue;
    }

    if (ch === '"') {
      out += ' ';
      i++;
      state = 'double';
      continue;
    }

    if (ch === '`') {
      out += ' ';
      i++;
      state = 'template';
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

export function extractTopLevelDeclaredNames(code: string): string[] {
  const names: string[] = [];
  const len = code.length;
  let i = 0;
  let braceDepth = 0;
  let parenDepth = 0;

  const skipString = (quote: string): void => {
    i++;
    if (quote === '`') {
      let templateDepth = 0;
      while (i < len) {
        const ch = code[i]!;
        if (ch === '\\') {
          i += 2;
          continue;
        }
        if (templateDepth > 0) {
          if (ch === '{') {
            templateDepth++;
          } else if (ch === '}') {
            templateDepth--;
          }
          i++;
          continue;
        }
        if (ch === '$' && i + 1 < len && code[i + 1] === '{') {
          templateDepth++;
          i += 2;
          continue;
        }
        if (ch === '`') {
          i++;
          return;
        }
        i++;
      }
      return;
    }

    while (i < len) {
      const ch = code[i]!;
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === quote) {
        i++;
        return;
      }
      i++;
    }
  };

  const skipLineComment = (): void => {
    i += 2;
    while (i < len && code[i] !== '\n') {
      i++;
    }
  };

  const skipBlockComment = (): void => {
    i += 2;
    while (i < len) {
      if (code[i] === '*' && i + 1 < len && code[i + 1] === '/') {
        i += 2;
        return;
      }
      i++;
    }
  };

  const readWord = (): string => {
    const start = i;
    while (i < len && isIdentifierChar(code[i])) {
      i++;
    }
    return code.slice(start, i);
  };

  const skipWhitespace = (): boolean => {
    const start = i;
    while (i < len) {
      const ch = code[i]!;
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        i++;
        continue;
      }
      if (ch === '/' && i + 1 < len) {
        if (code[i + 1] === '/') {
          skipLineComment();
          continue;
        }
        if (code[i + 1] === '*') {
          skipBlockComment();
          continue;
        }
      }
      break;
    }
    return i > start;
  };

  const extractDestructuredNames = (close: string): void => {
    let depth = 1;
    while (i < len && depth > 0) {
      skipWhitespace();
      if (i >= len) return;
      const ch = code[i]!;
      if (ch === close) {
        depth--;
        i++;
        continue;
      }
      if (ch === '{' || ch === '[') {
        const nestedClose = ch === '{' ? '}' : ']';
        i++;
        extractDestructuredNames(nestedClose);
        continue;
      }
      if (
        ch === '.' &&
        i + 2 < len &&
        code[i + 1] === '.' &&
        code[i + 2] === '.'
      ) {
        i += 3;
        skipWhitespace();
        if (i < len && isIdentifierChar(code[i])) {
          const name = readWord();
          if (name) names.push(name);
        }
        continue;
      }
      if (ch === ',') {
        i++;
        continue;
      }
      if (ch === '=') {
        i++;
        let eqDepth = 0;
        while (i < len) {
          const current = code[i]!;
          if (current === "'" || current === '"' || current === '`') {
            skipString(current);
            continue;
          }
          if (current === '(' || current === '[' || current === '{') {
            eqDepth++;
            i++;
            continue;
          }
          if (current === ')' || current === ']' || current === '}') {
            if (eqDepth > 0) {
              eqDepth--;
              i++;
              continue;
            }
            break;
          }
          if (current === ',' && eqDepth === 0) {
            break;
          }
          i++;
        }
        continue;
      }
      if (isIdentifierChar(ch)) {
        const word = readWord();
        skipWhitespace();
        if (i < len && code[i] === ':') {
          i++;
          skipWhitespace();
          if (i < len) {
            const current = code[i]!;
            if (current === '{' || current === '[') {
              const nestedClose = current === '{' ? '}' : ']';
              i++;
              extractDestructuredNames(nestedClose);
            } else if (isIdentifierChar(current)) {
              const renamed = readWord();
              if (renamed) names.push(renamed);
            }
          }
        } else if (word) {
          names.push(word);
        }
        continue;
      }
      i++;
    }
  };

  const skipToCommaOrEnd = (): boolean => {
    let depth = 0;
    while (i < len) {
      const ch = code[i]!;
      if (ch === "'" || ch === '"' || ch === '`') {
        skipString(ch);
        continue;
      }
      if (ch === '/' && i + 1 < len) {
        if (code[i + 1] === '/') {
          skipLineComment();
          continue;
        }
        if (code[i + 1] === '*') {
          skipBlockComment();
          continue;
        }
      }
      if (ch === '(' || ch === '[' || ch === '{') {
        depth++;
        i++;
        continue;
      }
      if (ch === ')' || ch === ']' || ch === '}') {
        if (depth > 0) {
          depth--;
          i++;
          continue;
        }
        return false;
      }
      if (ch === ',' && depth === 0) {
        i++;
        return true;
      }
      if (ch === ';' && depth === 0) {
        i++;
        return false;
      }
      if (ch === '\n' && depth === 0) {
        const savedIndex = i;
        i++;
        skipWhitespace();
        if (i < len && code[i] === ',') {
          i++;
          return true;
        }
        i = savedIndex;
        return false;
      }
      i++;
    }
    return false;
  };

  const extractBindings = (): void => {
    while (i < len) {
      skipWhitespace();
      if (i >= len) return;
      const ch = code[i]!;

      if (ch === '{') {
        i++;
        extractDestructuredNames('}');
        if (!skipToCommaOrEnd()) return;
        continue;
      }
      if (ch === '[') {
        i++;
        extractDestructuredNames(']');
        if (!skipToCommaOrEnd()) return;
        continue;
      }
      if (isIdentifierChar(ch)) {
        const name = readWord();
        if (name) names.push(name);
        if (!skipToCommaOrEnd()) return;
        continue;
      }
      return;
    }
  };

  const isStatementBoundary = (pos: number): boolean => {
    if (pos === 0) return true;
    let j = pos - 1;
    while (j >= 0) {
      const ch = code[j]!;
      if (ch === ' ' || ch === '\t' || ch === '\r') {
        j--;
        continue;
      }
      return ch === '\n' || ch === ';' || ch === '{' || ch === '}';
    }
    return true;
  };

  while (i < len) {
    const ch = code[i]!;

    if (ch === "'" || ch === '"' || ch === '`') {
      skipString(ch);
      continue;
    }

    if (ch === '/' && i + 1 < len) {
      if (code[i + 1] === '/') {
        skipLineComment();
        continue;
      }
      if (code[i + 1] === '*') {
        skipBlockComment();
        continue;
      }
    }

    if (ch === '{') {
      braceDepth++;
      i++;
      continue;
    }
    if (ch === '}') {
      braceDepth--;
      i++;
      continue;
    }
    if (ch === '(') {
      parenDepth++;
      i++;
      continue;
    }
    if (ch === ')') {
      parenDepth--;
      i++;
      continue;
    }

    if (braceDepth === 0 && parenDepth === 0 && isIdentifierChar(ch)) {
      const wordStart = i;
      const word = readWord();
      if (
        (word === 'var' || word === 'let' || word === 'const') &&
        i < len &&
        (code[i] === ' ' || code[i] === '\t' || code[i] === '\n') &&
        isStatementBoundary(wordStart)
      ) {
        extractBindings();
      }
      continue;
    }

    i++;
  }

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const name of names) {
    if (!seen.has(name)) {
      seen.add(name);
      unique.push(name);
    }
  }
  return unique;
}

export function extractTopLevelDurableWriteTargets(code: string): string[] {
  const names = new Set<string>(extractTopLevelDeclaredNames(code));
  const sanitized = stripJsStringsAndComments(code);
  const len = sanitized.length;
  let i = 0;
  let braceDepth = 0;
  let parenDepth = 0;

  const skipWhitespace = (index: number): number => {
    let current = index;
    while (current < len && /\s/.test(sanitized[current] ?? '')) {
      current++;
    }
    return current;
  };

  const previousNonWhitespaceIndex = (index: number): number => {
    let current = index;
    while (current >= 0 && /\s/.test(sanitized[current] ?? '')) {
      current--;
    }
    return current;
  };

  const isAssignmentOperatorAt = (index: number): boolean => {
    const threeChars = sanitized.slice(index, index + 3);
    const twoChars = sanitized.slice(index, index + 2);

    if (threeChars === '===' || twoChars === '==' || twoChars === '=>') {
      return false;
    }

    return (
      sanitized[index] === '=' ||
      [
        '+=',
        '-=',
        '*=',
        '/=',
        '%=',
        '&=',
        '|=',
        '^=',
        '&&=',
        '||=',
        '??=',
        '**=',
        '<<=',
        '>>=',
        '>>>=',
      ].some((op) => sanitized.startsWith(op, index))
    );
  };

  const readWord = (start: number): { word: string; nextIndex: number } => {
    let nextIndex = start;
    while (nextIndex < len && isIdentifierChar(sanitized[nextIndex])) {
      nextIndex++;
    }
    return { word: sanitized.slice(start, nextIndex), nextIndex };
  };

  const addIfBareAssignment = (word: string, start: number, end: number) => {
    const prevIndex = previousNonWhitespaceIndex(start - 1);
    const prev = prevIndex >= 0 ? sanitized[prevIndex] : undefined;
    const nextIndex = skipWhitespace(end);
    const isMemberAccess = prev === '.' || prev === '?';
    if (isMemberAccess) {
      return;
    }

    const hasPrefixUpdate =
      sanitized.slice(Math.max(0, start - 2), start) === '++' ||
      sanitized.slice(Math.max(0, start - 2), start) === '--';
    const hasSuffixUpdate =
      sanitized.startsWith('++', nextIndex) ||
      sanitized.startsWith('--', nextIndex);

    if (
      hasPrefixUpdate ||
      hasSuffixUpdate ||
      isAssignmentOperatorAt(nextIndex)
    ) {
      names.add(word);
    }
  };

  const addIfGlobalAssignment = (start: number, end: number) => {
    const dotIndex = skipWhitespace(end);
    if (sanitized[dotIndex] !== '.') {
      return;
    }

    const nameStart = skipWhitespace(dotIndex + 1);
    if (!isIdentifierStart(sanitized[nameStart])) {
      return;
    }

    const { word: propertyName, nextIndex } = readWord(nameStart);
    const operatorIndex = skipWhitespace(nextIndex);
    const hasPrefixUpdate =
      sanitized.slice(Math.max(0, start - 2), start) === '++' ||
      sanitized.slice(Math.max(0, start - 2), start) === '--';
    const hasSuffixUpdate =
      sanitized.startsWith('++', operatorIndex) ||
      sanitized.startsWith('--', operatorIndex);

    if (
      propertyName &&
      (hasPrefixUpdate ||
        hasSuffixUpdate ||
        isAssignmentOperatorAt(operatorIndex))
    ) {
      names.add(propertyName);
    }
  };

  while (i < len) {
    const ch = sanitized[i]!;

    if (ch === '{') {
      braceDepth++;
      i++;
      continue;
    }
    if (ch === '}') {
      braceDepth--;
      i++;
      continue;
    }
    if (ch === '(') {
      parenDepth++;
      i++;
      continue;
    }
    if (ch === ')') {
      parenDepth--;
      i++;
      continue;
    }

    if (braceDepth === 0 && parenDepth === 0 && isIdentifierStart(ch)) {
      const start = i;
      const { word, nextIndex } = readWord(i);
      i = nextIndex;

      if (!word) {
        continue;
      }
      if (word === 'globalThis') {
        addIfGlobalAssignment(start, nextIndex);
        continue;
      }
      addIfBareAssignment(word, start, nextIndex);
      continue;
    }

    i++;
  }

  return [...names];
}
