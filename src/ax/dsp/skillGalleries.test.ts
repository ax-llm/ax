import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { flow } from '../flow/flow.js';
import { s } from './template.js';

// The skill docs ship gallery signatures and mermaid flows that users copy
// verbatim. These tests parse/compile every gallery entry with the real
// parser and compiler so the docs cannot rot (a doc example once shipped
// with a class-typed input, which the parser rejects).

const readSkill = (name: string): string =>
  readFileSync(new URL(`../skills/${name}`, import.meta.url), 'utf8');

const readWebsiteTemplate = (name: string): string =>
  readFileSync(
    new URL(`../../../website/content-src/templates/${name}`, import.meta.url),
    'utf8'
  );

const fencedBlocks = (markdown: string, fence: string): string[] => {
  const blocks: string[] = [];
  const re = new RegExp(`\`\`\`${fence}\\n([\\s\\S]*?)\`\`\``, 'g');
  for (const match of markdown.matchAll(re)) {
    blocks.push(match[1] ?? '');
  }
  return blocks;
};

describe('skill doc galleries', () => {
  it('every ax-signature.md Signature Gallery entry parses and round-trips', () => {
    const doc = readSkill('ax-signature.md');
    const section = doc.split('## Signature Gallery')[1];
    expect(section, 'Signature Gallery section missing').toBeTruthy();
    const block = fencedBlocks(section!, 'text')[0];
    expect(block, 'Signature Gallery fence missing').toBeTruthy();

    const signatures = block!
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
    expect(signatures.length).toBeGreaterThanOrEqual(20);

    for (const signature of signatures) {
      const rendered = s(signature).toString();
      expect(s(rendered).toString(), signature).toBe(rendered);
    }
  });

  it('every ax-flow.md mermaid gallery diagram compiles and round-trips', () => {
    const doc = readSkill('ax-flow.md');
    const diagrams = fencedBlocks(doc, 'text').filter((block) =>
      block.includes('%%ax')
    );
    expect(diagrams.length).toBeGreaterThanOrEqual(9);

    for (const diagram of diagrams) {
      // While-loop conditions are host-owned closures; supply trivial ones.
      const conditionNames = [...diagram.matchAll(/\|while\s+(\w+)/g)].map(
        (match) => match[1] as string
      );
      const bindings = conditionNames.length
        ? {
            conditions: Object.fromEntries(
              conditionNames.map((name) => [name, () => false])
            ),
          }
        : undefined;
      const wf = flow(diagram, bindings);
      // Round-trip: the rendered dialect must recompile.
      flow(String(wf), bindings);
    }
  });

  it('every website signature gallery entry parses and round-trips', () => {
    for (const [name, minimum] of [
      ['concept-signatures.md', 12],
      ['subsystem-s.md', 6],
    ] as const) {
      const doc = readWebsiteTemplate(name);
      const gallery =
        name === 'concept-signatures.md'
          ? doc
              .split('## Signature Gallery')[1]
              ?.split('## Production Notes')[0]
          : doc;
      expect(gallery, `${name}: gallery section missing`).toBeTruthy();
      const blocks = fencedBlocks(gallery!, 'text').filter((block) =>
        name === 'concept-signatures.md'
          ? block.includes('->') && !block.includes('%%ax')
          : block.includes('postText:string ->')
      );
      const signatures = blocks
        .flatMap((block) => block.split('\n'))
        .map((line) => line.trim())
        .filter(
          (line) =>
            line.length > 0 && !line.startsWith('#') && line.includes('->')
        );
      expect(signatures.length, name).toBeGreaterThanOrEqual(minimum);

      for (const signature of signatures) {
        const rendered = s(signature).toString();
        expect(s(rendered).toString(), `${name}: ${signature}`).toBe(rendered);
      }
    }
  });

  it('every website mermaid gallery diagram compiles and round-trips', () => {
    const doc = readWebsiteTemplate('subsystem-flow.md');
    const diagrams = fencedBlocks(doc, 'text').filter((block) =>
      block.includes('%%ax')
    );
    expect(diagrams.length).toBeGreaterThanOrEqual(7);

    for (const diagram of diagrams) {
      const conditionNames = [...diagram.matchAll(/\|while\s+(\w+)/g)].map(
        (match) => match[1] as string
      );
      const bindings = conditionNames.length
        ? {
            conditions: Object.fromEntries(
              conditionNames.map((name) => [name, () => false])
            ),
          }
        : undefined;
      const wf = flow(diagram, bindings);
      flow(String(wf), bindings);
    }
  });
});
