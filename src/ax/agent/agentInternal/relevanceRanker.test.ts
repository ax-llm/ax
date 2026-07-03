import { describe, expect, it } from 'vitest';
import {
  type AxModuleRankInput,
  type AxRankableDocument,
  rankDocuments,
  rankModules,
  renderRelevanceHintsMarkdown,
  splitIdentifierWords,
} from './relevanceRanker.js';

describe('splitIdentifierWords', () => {
  it.each([
    ['searchDocsByID', ['search', 'docs', 'by', 'id']],
    ['send_email', ['send', 'email']],
    ['HTTPServer', ['http', 'server']],
    ['find-next-slot', ['find', 'next', 'slot']],
    ['calendar.eventsOnDate', ['calendar', 'events', 'on', 'date']],
    ['v2', ['v2']],
    ['a', []], // length-1 dropped
    ['42', []], // pure number dropped
  ])('splits %s', (input, expected) => {
    expect(splitIdentifierWords(input)).toEqual(expected);
  });
});

const DOCS: AxModuleRankInput = {
  namespace: 'docs',
  title: 'Documentation Search',
  selectionCriteria:
    'Use when the user needs to find or read documentation, articles, or knowledge base pages',
  functionNames: ['search', 'read'],
};
const MATH: AxModuleRankInput = {
  namespace: 'math',
  title: 'Arithmetic',
  selectionCriteria: 'Use for calculations, sums, and numeric operations',
  functionNames: ['add', 'multiply'],
};
const CALENDAR: AxModuleRankInput = {
  namespace: 'calendar',
  title: 'Calendar',
  selectionCriteria: 'Use to look up meetings and availability',
  functionNames: ['eventsOnDate', 'findSlot'],
};

describe('rankModules — relevance', () => {
  it('ranks the on-topic module first', () => {
    const ranked = rankModules(
      'search the documentation to find the API reference',
      [MATH, CALENDAR, DOCS]
    );
    expect(ranked[0]?.namespace).toBe('docs');
    expect(ranked.map((r) => r.namespace)).not.toContain('math'); // no match
    expect(ranked[0]?.score).toBe(1); // top normalized to 1
  });
});

// Three modules, each keyed to distinct rare terms: A matches 2, B and C match 1.
const A: AxModuleRankInput = {
  namespace: 'alpha',
  selectionCriteria: 'apple banana',
};
const B: AxModuleRankInput = {
  namespace: 'beta',
  selectionCriteria: 'cherry',
};
const C: AxModuleRankInput = {
  namespace: 'gamma',
  selectionCriteria: 'kiwi',
};

describe('rankModules — guards', () => {
  it('emits nothing for a single-module catalog', () => {
    expect(rankModules('search the docs', [DOCS])).toEqual([]);
  });

  it('emits nothing when no query term matches any module', () => {
    expect(rankModules('xyzzy foobar quux', [DOCS, MATH, CALENDAR])).toEqual(
      []
    );
  });

  it('emits nothing when the whole catalog is tied (cannot discriminate)', () => {
    const tied = ['one', 'two', 'three'].map((ns) => ({
      namespace: ns,
      selectionCriteria: 'zebra quokka',
    }));
    expect(rankModules('zebra quokka', tied)).toEqual([]);
  });

  it('respects the absolute minScore floor on the top match', () => {
    const task = 'apple banana cherry kiwi';
    // top (alpha) covers 2 of 4 idf-weighted terms => coverage 0.5
    expect(rankModules(task, [A, B, C], { minScore: 0.4 })[0]?.namespace).toBe(
      'alpha'
    );
    expect(rankModules(task, [A, B, C], { minScore: 0.6 })).toEqual([]);
  });

  it('truncates to topK with a stable namespace tiebreak', () => {
    const ranked = rankModules('apple banana cherry kiwi', [A, B, C], {
      topK: 2,
    });
    expect(ranked).toHaveLength(2);
    expect(ranked.map((r) => r.namespace)).toEqual(['alpha', 'beta']); // beta < gamma
  });
});

describe('rankDocuments — core', () => {
  const doc = (id: string, ...fields: AxRankableDocument['fields']) => ({
    id,
    fields,
  });

  it('weight multiplies term contribution and changes ordering', () => {
    // Both docs mention "billing" once; heavy weights it up.
    const light = doc('light', { text: 'billing and other things' });
    const heavy = doc('heavy', { text: 'billing', weight: 3 });
    const decoy = doc('decoy', { text: 'unrelated zebra content' });
    const ranked = rankDocuments('billing question', [light, heavy, decoy]);
    expect(ranked[0]?.id).toBe('heavy');
    expect(ranked.map((r) => r.id)).toContain('light');
  });

  it('identifier fields tokenize camelCase; prose fields do not', () => {
    const identifierDoc = doc('ident', {
      text: 'lookupInvoiceStatus',
      identifier: true,
    });
    const proseDoc = doc('prose', { text: 'lookupInvoiceStatus' });
    const decoy = doc('decoy', { text: 'zebra' });
    // Query uses the SPLIT words — only the identifier doc matches them.
    const ranked = rankDocuments('invoice status', [
      identifierDoc,
      proseDoc,
      decoy,
    ]);
    expect(ranked[0]?.id).toBe('ident');
    expect(ranked.map((r) => r.id)).not.toContain('prose');
  });

  it('minDocs: 1 enables best-effort mode over a single document', () => {
    const only = doc('only', { text: 'release checklist steps' });
    expect(rankDocuments('release checklist', [only])).toEqual([]); // default guard
    const ranked = rankDocuments('release checklist', [only], {
      minDocs: 1,
      marginRatio: 0,
      minScore: 0,
    });
    expect(ranked[0]?.id).toBe('only');
  });

  it('marginRatio: 0 disables the tie guard (explicit-search mode)', () => {
    const tied = ['one', 'two'].map((id) => doc(id, { text: 'zebra quokka' }));
    expect(rankDocuments('zebra', tied)).toEqual([]); // default: tied => nothing
    const ranked = rankDocuments('zebra', tied, {
      marginRatio: 0,
      minScore: 0,
    });
    expect(ranked.map((r) => r.id)).toEqual(['one', 'two']); // id tiebreak
  });

  it('reports matched terms for telemetry', () => {
    const ranked = rankDocuments(
      'apple banana',
      [
        doc('a', { text: 'apple banana' }),
        doc('b', { text: 'apple' }),
        doc('c', { text: 'zebra' }),
      ],
      { marginRatio: 0, minScore: 0 }
    );
    expect(ranked[0]?.matchedTerms.sort()).toEqual(['apple', 'banana']);
  });
});

describe('renderRelevanceHintsMarkdown', () => {
  it('returns undefined when every domain is empty', () => {
    expect(renderRelevanceHintsMarkdown({})).toBeUndefined();
    expect(
      renderRelevanceHintsMarkdown({ modules: [], skills: [], memories: [] })
    ).toBeUndefined();
  });

  it('renders module namespaces as a labeled bullet list', () => {
    expect(
      renderRelevanceHintsMarkdown({
        modules: [{ namespace: 'docs' }, { namespace: 'calendar' }],
      })
    ).toBe('Modules:\n- `docs`\n- `calendar`');
  });

  it('renders all three domains as labeled sections', () => {
    expect(
      renderRelevanceHintsMarkdown({
        modules: [{ namespace: 'orders' }],
        skills: [{ id: 'release-checklist', name: 'Release checklist' }],
        memories: [{ id: 'coffee', snippet: 'User prefers coffee' }],
      })
    ).toBe(
      [
        'Modules:\n- `orders`',
        'Skills:\n- `release-checklist` — Release checklist',
        'Memories:\n- `coffee` — User prefers coffee',
      ].join('\n')
    );
  });
});
