import { describe, expect, it } from 'vitest';

import { normalizeActorJavascriptCode } from './optimize.js';

describe('normalizeActorJavascriptCode', () => {
  it('passes through plain code unchanged', () => {
    const code = `const x = 1;\nconsole.log(x);`;
    expect(normalizeActorJavascriptCode(code)).toBe(code);
  });

  it('strips ```javascript fences at the exact boundaries', () => {
    const fenced = '```javascript\nconst x = 1;\nconsole.log(x);\n```';
    expect(normalizeActorJavascriptCode(fenced)).toBe(
      `const x = 1;\nconsole.log(x);`
    );
  });

  it('strips bare ``` fences without a language tag', () => {
    const fenced = '```\nconst x = 1;\nconsole.log(x);\n```';
    expect(normalizeActorJavascriptCode(fenced)).toBe(
      `const x = 1;\nconsole.log(x);`
    );
  });

  it('extracts the inner code when the model prefixes prose before the fence', () => {
    const noisy = `Looking at the previous result, the query returned individual records. I need to use the proper aggregation:
\`\`\`javascript
const result = await data.query('{ orders { count_id sum_total } }');
console.log(result);
\`\`\``;
    expect(normalizeActorJavascriptCode(noisy)).toBe(
      `const result = await data.query('{ orders { count_id sum_total } }');\nconsole.log(result);`
    );
  });

  it('removes paired <think>...</think> reasoning blocks', () => {
    const withThink = `<think>Let me reason about this step by step.</think>const x = 1;\nconsole.log(x);`;
    expect(normalizeActorJavascriptCode(withThink)).toBe(
      `const x = 1;\nconsole.log(x);`
    );
  });

  it('removes orphan </think> closers without a matching opener', () => {
    const orphan = `Some leaked reasoning</think>const x = 1;\nconsole.log(x);`;
    expect(normalizeActorJavascriptCode(orphan)).toBe(
      `const x = 1;\nconsole.log(x);`
    );
  });

  it('handles prose + </think> + fenced code combined', () => {
    const ugly = `I will now run the query:</think>\`\`\`javascript
const result = await data.query('{ users(limit: 1) { count_id } }');
console.log(result);
\`\`\``;
    expect(normalizeActorJavascriptCode(ugly)).toBe(
      `const result = await data.query('{ users(limit: 1) { count_id } }');\nconsole.log(result);`
    );
  });

  it('extracts the first fenced block when multiple are present', () => {
    const multi = `First attempt:
\`\`\`javascript
const a = 1;
console.log(a);
\`\`\`
Second attempt:
\`\`\`javascript
const b = 2;
console.log(b);
\`\`\``;
    expect(normalizeActorJavascriptCode(multi)).toBe(
      `const a = 1;\nconsole.log(a);`
    );
  });

  it('returns the input as-is when there are no fences and no think tags', () => {
    const code = `const result = await data.query('{ orders { count_id } }');\nconsole.log(result);`;
    expect(normalizeActorJavascriptCode(code)).toBe(code);
  });
});
