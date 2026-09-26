// Number literals a fixture keeps verbatim, such as 2.0 or -0.0.
//
// JSON.stringify would write them as 2 and 0, but the runners need the
// literal: Python, Rust and Java parse 2.0 as a float (json.dumps and
// serde_json write that back as "2.0"), and every port parses -0.0 as negative
// zero. The TS golden renders what JSON.parse returns for the literal
// (goldenValue), which is what TS itself would see in the fixture.
//
// Regenerate these fixtures by running the extractor directly:
// `npm run axir:conformance:write` rewrites fixtures in normalized form, which
// drops the literals.

const literalTag = '\u0000number-literal:';

export class NumberLiteral {
  constructor(readonly text: string) {}

  toJSON(): string {
    return `${literalTag}${this.text}`;
  }
}

// The value TS sees once JSON.parse has read the fixture.
export function goldenValue<T>(value: T): T {
  if (value instanceof NumberLiteral) return JSON.parse(value.text);
  if (Array.isArray(value)) return value.map(goldenValue) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, goldenValue(item)])
    ) as T;
  }
  return value;
}

// Swap the JSON.stringify placeholders for the literals.
export function restoreNumberLiterals(json: string): string {
  return json.replace(/"\\u0000number-literal:([^"]*)"/g, '$1');
}
