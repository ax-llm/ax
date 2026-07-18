import { describe, expect, it } from 'vitest';

import { AxFlowMermaidError, parseFlowMermaid } from './mermaid.js';

describe('parseFlowMermaid', () => {
  it('parses headers, directives, node shapes and edges', () => {
    const ast = parseFlowMermaid(
      [
        'flowchart LR',
        '  %%ax summarize: documentText:string -> summaryText:string',
        '  %% a plain comment',
        '  summarize[Summarize document] --> check{verdict}',
        '  check -->|pass| format([Format it])',
        '',
      ].join('\n')
    );

    expect(ast.direction).toBe('LR');
    expect(ast.directives.get('summarize')?.signatureText).toBe(
      'documentText:string -> summaryText:string'
    );
    expect(ast.nodes.get('summarize')).toMatchObject({
      shape: 'rect',
      label: 'Summarize document',
    });
    expect(ast.nodes.get('check')).toMatchObject({
      shape: 'diamond',
      label: 'verdict',
    });
    expect(ast.nodes.get('format')).toMatchObject({
      shape: 'round',
      label: 'Format it',
    });
    expect(ast.edges).toEqual([
      { from: 'summarize', to: 'check', label: undefined, line: 4 },
      { from: 'check', to: 'format', label: 'pass', line: 5 },
    ]);
  });

  it('expands chains and & fans into individual edges', () => {
    const ast = parseFlowMermaid(
      [
        'flowchart TD',
        '  alpha --> beta --> gamma',
        '  alpha & beta --> delta',
        '  gamma --> epsilon & zeta',
      ].join('\n')
    );
    const pairs = ast.edges.map((e) => `${e.from}->${e.to}`);
    expect(pairs).toEqual([
      'alpha->beta',
      'beta->gamma',
      'alpha->delta',
      'beta->delta',
      'gamma->epsilon',
      'gamma->zeta',
    ]);
  });

  it('keeps labels with commas intact and strips label quotes', () => {
    const ast = parseFlowMermaid(
      [
        'flowchart TD',
        '  check{verdict} -->|fail, max 3| summarize["Try again"]',
      ].join('\n')
    );
    expect(ast.edges[0]?.label).toBe('fail, max 3');
    expect(ast.nodes.get('summarize')?.label).toBe('Try again');
  });

  it('records first-appearance order for back-edge classification', () => {
    const ast = parseFlowMermaid(
      ['flowchart TD', '  alpha --> beta', '  beta --> alpha'].join('\n')
    );
    expect(ast.order.get('alpha')).toBe(0);
    expect(ast.order.get('beta')).toBe(1);
  });

  const rejections: [string, string[], RegExp][] = [
    [
      'subgraph',
      ['flowchart TD', 'subgraph one', 'a --> b', 'end'],
      /Unsupported mermaid construct "subgraph"/,
    ],
    [
      'style',
      ['flowchart TD', 'a --> b', 'style a fill:#f9f'],
      /Unsupported mermaid construct "style"/,
    ],
    [
      'classDef',
      ['flowchart TD', 'a --> b', 'classDef green fill:#9f6'],
      /Unsupported mermaid construct "classDef"/,
    ],
    [
      'click',
      ['flowchart TD', 'a --> b', 'click a callback'],
      /Unsupported mermaid construct "click"/,
    ],
    ['dotted arrow', ['flowchart TD', 'a -.-> b'], /Unsupported arrow syntax/],
    ['thick arrow', ['flowchart TD', 'a ==> b'], /Unsupported arrow syntax/],
    ['open link', ['flowchart TD', 'a --- b'], /Unsupported arrow syntax/],
    ['missing header', ['a --> b'], /Missing flowchart header/],
    [
      'duplicate %%ax',
      [
        'flowchart TD',
        '%%ax n: a:string -> b:string',
        '%%ax n: a:string -> c:string',
        'n --> n2',
      ],
      /Duplicate %%ax directive/,
    ],
    ['bad node id', ['flowchart TD', '1abc --> b'], /Expected a node id/],
    ['trailing garbage', ['flowchart TD', 'a --> b ###'], /Unexpected content/],
    ['empty document', ['flowchart TD'], /No nodes found/],
  ];

  for (const [label, docLines, matcher] of rejections) {
    it(`rejects ${label}`, () => {
      expect(() => parseFlowMermaid(docLines.join('\n'))).toThrow(matcher);
      try {
        parseFlowMermaid(docLines.join('\n'));
      } catch (error) {
        expect(error).toBeInstanceOf(AxFlowMermaidError);
      }
    });
  }
});
