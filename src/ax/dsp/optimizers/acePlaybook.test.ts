import { describe, expect, it } from 'vitest';

import {
  applyCuratorOperations,
  createEmptyPlaybook,
  generateBulletId,
} from './acePlaybook.js';
import type { AxACECuratorOperation } from './aceTypes.js';

function makePlaybookWithSection(
  section: string,
  bullets: Array<{
    id?: string;
    content: string;
    helpfulCount?: number;
    harmfulCount?: number;
  }>
) {
  const playbook = createEmptyPlaybook();
  playbook.sections[section] = bullets.map((entry) => ({
    id: entry.id ?? generateBulletId(section),
    section,
    content: entry.content,
    helpfulCount: entry.helpfulCount ?? 0,
    harmfulCount: entry.harmfulCount ?? 0,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  }));
  return playbook;
}

describe('applyCuratorOperations', () => {
  it('updates existing bullets and protects them from pruning', () => {
    const playbook = makePlaybookWithSection('Guidelines', [
      { id: 'guidel-1', content: 'Old content', helpfulCount: 3 },
      { id: 'guidel-2', content: 'Another bullet', helpfulCount: 1 },
    ]);

    const operations: AxACECuratorOperation[] = [
      {
        type: 'UPDATE',
        section: 'Guidelines',
        bulletId: 'guidel-1',
        content: 'Refined guidance',
      },
      {
        type: 'ADD',
        section: 'Guidelines',
        content: 'Fresh insight',
      },
    ];

    const result = applyCuratorOperations(playbook, operations, {
      maxSectionSize: 3,
      enableAutoPrune: true,
      protectedBulletIds: new Set(['guidel-1']),
    });

    expect(result.autoRemoved).toHaveLength(0);
    expect(result.updatedBulletIds).toEqual(
      expect.arrayContaining(['guidel-1'])
    );

    const updated = playbook.sections.Guidelines.find(
      (bullet) => bullet.id === 'guidel-1'
    );
    expect(updated?.content).toBe('Refined guidance');
  });

  it('auto prunes the least helpful bullet when section is full', () => {
    const playbook = makePlaybookWithSection('Response Strategies', [
      { id: 'resp-1', content: 'Useful', helpfulCount: 4 },
      { id: 'resp-2', content: 'Mediocre', helpfulCount: 1 },
    ]);

    const operations: AxACECuratorOperation[] = [
      {
        type: 'ADD',
        section: 'Response Strategies',
        content: 'Brand new tactic',
      },
    ];

    const result = applyCuratorOperations(playbook, operations, {
      maxSectionSize: 2,
      enableAutoPrune: true,
    });

    expect(result.autoRemoved).toHaveLength(1);
    expect(result.autoRemoved[0]).toMatchObject({
      type: 'REMOVE',
      section: 'Response Strategies',
    });

    const ids = playbook.sections['Response Strategies'].map(
      (bullet) => bullet.id
    );
    expect(ids).toHaveLength(2);
    expect(ids).toContain(result.updatedBulletIds.at(-1));
    expect(ids).not.toContain('resp-2');
  });

  it('skips additions when capacity reached and auto prune disabled', () => {
    const playbook = makePlaybookWithSection('Common Pitfalls', [
      { id: 'pit-1', content: 'Watch out for bias' },
      { id: 'pit-2', content: 'Avoid scope creep' },
    ]);

    const operations: AxACECuratorOperation[] = [
      {
        type: 'ADD',
        section: 'Common Pitfalls',
        content: 'New pitfall',
      },
    ];

    const result = applyCuratorOperations(playbook, operations, {
      maxSectionSize: 2,
      enableAutoPrune: false,
    });

    expect(result.updatedBulletIds).toHaveLength(0);
    expect(result.autoRemoved).toHaveLength(0);
    expect(playbook.sections['Common Pitfalls']).toHaveLength(2);
  });
});
