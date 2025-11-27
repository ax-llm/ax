import { describe, expect, it, vi } from 'vitest';

import { ax } from '../template.js';
import { f } from '../sig.js';
import type { AxAIService } from '../../ai/types.js';

import { applyCuratorOperations, createEmptyPlaybook } from './acePlaybook.js';
import { AxACE } from './ace.js';
import type {
  AxACECuratorOperation,
  AxACEPlaybook,
  AxACEReflectionOutput,
} from './aceTypes.js';

function buildPlaybook(sections: Record<string, string[]>): AxACEPlaybook {
  const playbook = createEmptyPlaybook();
  for (const [section, contents] of Object.entries(sections)) {
    playbook.sections[section] = contents.map((content, index) => ({
      id: `${section.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${index}`,
      section,
      content,
      helpfulCount: index,
      harmfulCount: 0,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }));
  }
  return playbook;
}

describe('AxACE helpers', () => {
  it('resolves curator operation targets using reflection tags', () => {
    const optimizer = Object.create(AxACE.prototype) as AxACE;

    const playbook = buildPlaybook({
      Guidelines: ['Keep reasoning explicit'],
      'Common Pitfalls': ['Missing policy hints'],
    });

    const operations: AxACECuratorOperation[] = [
      {
        type: 'UPDATE',
        section: 'Common Pitfalls',
        content: 'Mention missing policy hints',
      },
    ];

    const reflection: AxACEReflectionOutput = {
      reasoning: 'Missed policy hints',
      errorIdentification: 'Omitted policy hints',
      rootCauseAnalysis: 'No emphasis on hints',
      correctApproach: 'Include hints explicitly',
      keyInsight: 'Policy hints matter',
      bulletTags: [
        { id: 'common-pitfalls-0', tag: 'harmful' },
        { id: 'guidelines-0', tag: 'neutral' },
      ],
    };

    const resolved = (optimizer as any).resolveCuratorOperationTargets(
      operations,
      playbook,
      reflection,
      undefined
    ) as AxACECuratorOperation[];

    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.bulletId).toBe('common-pitfalls-0');
  });

  it('drops operations when no matching bullet exists in section', () => {
    const optimizer = Object.create(AxACE.prototype) as AxACE;

    const playbook = buildPlaybook({
      Guidelines: ['Keep reasoning explicit'],
    });

    const operations: AxACECuratorOperation[] = [
      {
        type: 'UPDATE',
        section: 'Common Pitfalls',
        content: 'Mention missing policy hints',
      },
    ];

    const resolved = (optimizer as any).resolveCuratorOperationTargets(
      operations,
      playbook,
      undefined,
      undefined
    ) as AxACECuratorOperation[];

    expect(resolved).toHaveLength(0);
  });

  it('protects updated bullets from auto prune', () => {
    const playbook = buildPlaybook({
      'Response Strategies': ['Primary tactic', 'Fallback tactic'],
    });

    const operations: AxACECuratorOperation[] = [
      {
        type: 'UPDATE',
        section: 'Response Strategies',
        bulletId: 'response-strategies-0',
        content: 'Primary tactic refined',
      },
      {
        type: 'ADD',
        section: 'Response Strategies',
        content: 'Third tactic',
      },
    ];

    const result = applyCuratorOperations(playbook, operations, {
      maxSectionSize: 2,
      enableAutoPrune: true,
      protectedBulletIds: new Set(['response-strategies-0']),
    });

    expect(result.autoRemoved).toHaveLength(1);
    expect(result.autoRemoved[0]?.bulletId).toBe('response-strategies-1');

    const remainingIds = playbook.sections['Response Strategies'].map(
      (bullet) => bullet.id
    );
    expect(remainingIds).toContain('response-strategies-0');
    expect(remainingIds).not.toContain('response-strategies-1');
    const newBullet = playbook.sections['Response Strategies'].find(
      (bullet) => bullet.id !== 'response-strategies-0'
    );
    expect(newBullet?.content).toBe('Third tactic');
  });
});

describe('AxACE', () => {
  it('runCurator should only receive input fields in question_context', async () => {
    const mockCuratorAI = {
      name: 'mockCurator',
      chat: vi.fn().mockResolvedValue({ results: [{ index: 0, content: '{"operations":[]}' }] }),
      getOptions: () => ({ tracer: undefined }),
      getLogger: () => undefined,
    } as unknown as AxAIService;

    const program = ax(
      f().input('question', f.string()).output('answer', f.string()).build()
    );

    const example = {
      question: 'This is the input',
      answer: 'This is the output',
    };

    const ace = new AxACE({
      studentAI: {} as any,
      teacherAI: mockCuratorAI,
    });

    // Spy on the chat method of the teacherAI instance
    const chatSpy = vi.spyOn(mockCuratorAI, 'chat');

    // Directly call the internal runCurator method for a focused unit test
    await (ace as any).runCurator({
      program,
      example,
      reflection: { keyInsight: 'test' }, // Minimal reflection to trigger curator
      playbook: { sections: {}, stats: { bulletCount: 0 } },
    });

    expect(chatSpy).toHaveBeenCalled();

    const chatMessages = (mockCuratorAI.chat as any).mock.calls[0][0];
    const lastMessage = chatMessages[chatMessages.length - 1];
    const messageData = JSON.parse(lastMessage.content as string);
    const receivedContext = JSON.parse(messageData.question_context);

    expect(receivedContext).toBeDefined();
    expect(receivedContext).toHaveProperty('question');
    expect(receivedContext.question).toBe('This is the input');
    expect(receivedContext).not.toHaveProperty('answer');
  });
});
