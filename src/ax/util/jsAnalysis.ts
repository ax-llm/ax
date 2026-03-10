function isIdentifierChar(ch: string | undefined): boolean {
  return !!ch && /[A-Za-z0-9_$]/.test(ch);
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
